"use server";

import { revalidatePath } from "next/cache";
import { getCurrentTech } from "../../../lib/current-tech";
import { db } from "../../../lib/supabase";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type CreateJobResult = { ok: true; hcp_job_id: string } | { ok: false; error: string };

export async function createJob(formData: FormData): Promise<CreateJobResult> {
  const me = await getCurrentTech();
  if (!me || !(me.isAdmin || me.isManager)) {
    return { ok: false, error: "Admin/manager only." };
  }
  if (!SERVICE_KEY) {
    return { ok: false, error: "Server misconfigured — SUPABASE_SERVICE_ROLE_KEY missing." };
  }

  const customer_id = String(formData.get("customer_id") ?? "").trim();
  const address_id = String(formData.get("address_id") ?? "").trim();
  const tech_employee_id = String(formData.get("tech_employee_id") ?? "").trim();
  const date_chi = String(formData.get("date") ?? "").trim();
  const start_time_chi = String(formData.get("start_time") ?? "").trim();
  const duration_min = Number(formData.get("duration_min") ?? 120);
  const arrival_window_minutes = Number(formData.get("arrival_window_minutes") ?? 60);
  const description = String(formData.get("description") ?? "").trim();
  const notify_customer = formData.get("notify_customer") === "on";

  if (!customer_id || !address_id || !tech_employee_id || !date_chi || !start_time_chi || !description) {
    return { ok: false, error: "Missing required field (customer, address, tech, date, time, or description)." };
  }

  const offset = chicagoOffsetForDate(date_chi);
  const startLocal = `${date_chi}T${start_time_chi}:00`;
  const startUtc = new Date(`${startLocal}${formatOffset(offset)}`);
  if (Number.isNaN(startUtc.getTime())) return { ok: false, error: "Invalid date/time." };
  const endUtc = new Date(startUtc.getTime() + Math.max(15, duration_min) * 60_000);

  const tags = ["dispatch-created"];
  if (!notify_customer) tags.push("no-notify");

  const body = {
    customer_id,
    address_id,
    scheduled_start: startUtc.toISOString(),
    scheduled_end: endUtc.toISOString(),
    assigned_employee_ids: [tech_employee_id],
    description,
    tags,
    work_status: "scheduled",
    arrival_window_minutes,
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-hcp-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      return { ok: false, error: json?.error ?? `create-hcp-job ${res.status}` };
    }

    // Bounce the new HCP appointment back into our DB BEFORE returning, so
    // the Schedule / Dispatch / My-day surfaces show it immediately rather
    // than waiting up to 30 min for the next tpar-appointments-sync cron.
    // Best-effort: if the sync errors we still report the create as ok.
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/hcp-sync-appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ daysBack: 1, daysForward: 7 }),
      });
    } catch { /* best-effort — the cron will catch up within 30 min */ }

    revalidatePath("/dispatch");
    revalidatePath("/schedule");
    revalidatePath("/me");
    return { ok: true, hcp_job_id: String(json.job_id ?? "") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function searchCustomers(q: string): Promise<Array<{
  hcp_customer_id: string; display_name: string; email: string | null; phone10: string | null;
  addresses: Array<{ address_id: string; street: string; city: string }>;
}>> {
  const me = await getCurrentTech();
  if (!me || !(me.isAdmin || me.isManager)) return [];
  const supa = db();
  const term = q.trim();
  if (term.length < 2) return [];

  // Search customers_master by name OR email (loose). We also need address_id which lives
  // on hcp_jobs_raw, so we'll join via hcp_customer_id to surface available addresses.
  const { data: customers } = await supa
    .from("customers_master")
    .select("hcp_customer_id, name, first_name, last_name, email, phone10")
    .or(`name.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,phone10.eq.${term.replace(/\D/g, "")}`)
    .limit(15);

  if (!customers || customers.length === 0) return [];

  // Pull address records for those customers from hcp_jobs_raw (most reliable source).
  const ids = customers.map((c) => c.hcp_customer_id);
  const { data: rawJobs } = await supa
    .from("hcp_jobs_raw")
    .select("hcp_customer_id, raw")
    .in("hcp_customer_id", ids)
    .order("scheduled_start", { ascending: false, nullsFirst: false })
    .limit(200);

  const addrsByCustomer = new Map<string, Map<string, { street: string; city: string }>>();
  for (const r of (rawJobs ?? []) as Array<{ hcp_customer_id: string; raw: Record<string, unknown> }>) {
    const addr = (r.raw?.["address"] ?? {}) as Record<string, unknown>;
    const aid = typeof addr["id"] === "string" ? addr["id"] : null;
    if (!aid) continue;
    const street = typeof addr["street"] === "string" ? addr["street"] : "";
    const city = typeof addr["city"] === "string" ? addr["city"] : "";
    if (!addrsByCustomer.has(r.hcp_customer_id)) addrsByCustomer.set(r.hcp_customer_id, new Map());
    addrsByCustomer.get(r.hcp_customer_id)!.set(aid, { street, city });
  }

  return customers.map((c) => {
    const addrs = Array.from((addrsByCustomer.get(c.hcp_customer_id) ?? new Map()).entries())
      .map(([address_id, v]) => ({ address_id, street: v.street, city: v.city }));
    const name = c.name ?? [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ?? "(unnamed)";
    return {
      hcp_customer_id: c.hcp_customer_id,
      display_name: name || "(unnamed)",
      email: c.email ?? null,
      phone10: c.phone10 ?? null,
      addresses: addrs,
    };
  });
}

export async function loadActiveTechs() {
  const supa = db();
  const { data } = await supa
    .from("tech_directory")
    .select("tech_short_name, hcp_full_name, hcp_employee_id, is_active, is_test, dashboard_role, is_lead")
    .eq("is_active", true)
    .neq("is_test", true)
    .in("dashboard_role", ["tech", "admin"])
    .not("hcp_employee_id", "is", null)
    .order("is_lead", { ascending: false })
    .order("tech_short_name");
  return (data ?? []) as Array<{
    tech_short_name: string; hcp_full_name: string; hcp_employee_id: string; is_lead: boolean | null;
  }>;
}

function chicagoOffsetForDate(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return -6;
  const second = nthSunday(y, 3, 2);
  const firstNov = nthSunday(y, 11, 1);
  const day = new Date(Date.UTC(y, m - 1, d));
  return day >= second && day < firstNov ? -5 : -6;
}

function nthSunday(year: number, month1: number, n: number): Date {
  const d = new Date(Date.UTC(year, month1 - 1, 1));
  const off = (7 - d.getUTCDay()) % 7;
  return new Date(Date.UTC(year, month1 - 1, 1 + off + 7 * (n - 1)));
}

function formatOffset(hours: number): string {
  const sign = hours >= 0 ? "+" : "-";
  const abs = Math.abs(hours);
  return `${sign}${String(Math.floor(abs)).padStart(2, "0")}:00`;
}
