"use server";

import { revalidatePath } from "next/cache";
import { getCurrentTech, requireScheduler } from "../../../lib/current-tech";
import { db } from "../../../lib/supabase";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type CreateEstimateResult = { ok: true; estimate_id: string } | { ok: false; error: string };

export async function createEstimate(formData: FormData): Promise<CreateEstimateResult> {
  const gate = await requireScheduler();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!SERVICE_KEY) return { ok: false, error: "Server misconfigured." };

  const customer_id = String(formData.get("customer_id") ?? "").trim();
  const address_id = String(formData.get("address_id") ?? "").trim();
  const tech_employee_id = String(formData.get("tech_employee_id") ?? "").trim();
  const date_chi = String(formData.get("date") ?? "").trim();
  const start_time_chi = String(formData.get("start_time") ?? "").trim();
  const duration_min = Number(formData.get("duration_min") ?? 30);
  const description = String(formData.get("description") ?? "").trim();
  const line_name = String(formData.get("line_name") ?? "").trim();
  const line_price_dollars = Number(formData.get("line_price_dollars") ?? 0);
  const line_qty = Number(formData.get("line_qty") ?? 1);
  const message = String(formData.get("message_from_pro") ?? "").trim();
  const notify_customer = formData.get("notify_customer") === "on";

  if (!customer_id || !address_id || !tech_employee_id || !date_chi || !start_time_chi) {
    return { ok: false, error: "Missing required field." };
  }
  if (!line_name) {
    return { ok: false, error: "At least one line item is required (HCP estimates need an Option with line_items)." };
  }

  const offset = chicagoOffsetForDate(date_chi);
  const startUtc = new Date(`${date_chi}T${start_time_chi}:00${formatOffset(offset)}`);
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
    description: description || "Estimate visit",
    tags,
    options: [{
      name: "Option #1",
      message_from_pro: message || undefined,
      line_items: [{
        name: line_name,
        unit_price: Math.round(line_price_dollars * 100),
        quantity: Math.max(1, line_qty),
        kind: "labor" as const,
      }],
    }],
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-hcp-estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) return { ok: false, error: json?.error ?? `create-hcp-estimate ${res.status}` };
    revalidatePath("/dispatch");
    return { ok: true, estimate_id: String(json.estimate_id ?? "") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function searchCustomers(q: string) {
  const me = await getCurrentTech();
  if (!me || !(me.isAdmin || me.isManager)) return [];
  const supa = db();
  const term = q.trim();
  if (term.length < 2) return [];

  const { data: customers } = await supa
    .from("customers_master")
    .select("hcp_customer_id, name, first_name, last_name, email, phone10")
    .or(`name.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,phone10.eq.${term.replace(/\D/g, "")}`)
    .limit(15);

  if (!customers || customers.length === 0) return [];

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
