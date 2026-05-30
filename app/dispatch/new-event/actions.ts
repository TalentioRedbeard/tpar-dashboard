"use server";

import { revalidatePath } from "next/cache";
import { getCurrentTech } from "../../../lib/current-tech";
import { db } from "../../../lib/supabase";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type CreateEventResult = { ok: true; hcp_job_id: string } | { ok: false; error: string };

export async function createEvent(formData: FormData): Promise<CreateEventResult> {
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
  const date_chi = String(formData.get("date") ?? "").trim();          // YYYY-MM-DD (Chicago)
  const start_time_chi = String(formData.get("start_time") ?? "").trim(); // HH:MM
  const duration_min = Number(formData.get("duration_min") ?? 60);
  const description = String(formData.get("description") ?? "").trim();

  if (!customer_id || !address_id || !tech_employee_id || !date_chi || !start_time_chi) {
    return { ok: false, error: "Missing required field." };
  }

  // Convert Chicago wall-clock to UTC ISO. America/Chicago is UTC-5 (CDT) or UTC-6 (CST).
  // Use a date constructor trick that works regardless of host TZ.
  const chiOffsetHours = chicagoOffsetForDate(date_chi);
  const startLocal = `${date_chi}T${start_time_chi}:00`;
  const startUtc = new Date(`${startLocal}${formatOffset(chiOffsetHours)}`);
  if (Number.isNaN(startUtc.getTime())) {
    return { ok: false, error: "Invalid date/time." };
  }
  const endUtc = new Date(startUtc.getTime() + Math.max(15, duration_min) * 60_000);

  const body = {
    customer_id,
    address_id,
    scheduled_start: startUtc.toISOString(),
    scheduled_end: endUtc.toISOString(),
    assigned_employee_ids: [tech_employee_id],
    description: description || "Internal event",
    tags: ["internal-event", "dispatch-created"],
    work_status: "scheduled",
    arrival_window_minutes: 0,
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-hcp-job`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      return { ok: false, error: json?.error ?? `create-hcp-job ${res.status}` };
    }

    // Bounce the new HCP appointment back into our DB BEFORE returning, so
    // the Schedule / Dispatch / My-day surfaces show it immediately rather
    // than waiting up to 30 min for the next tpar-appointments-sync cron.
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

// Returns -5 (CDT) or -6 (CST) for the given Chicago date. Quick rule: DST in CDT
// from second Sunday of March through first Sunday of November.
function chicagoOffsetForDate(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return -6;
  const year = y;
  const secondSundayMarch = nthSunday(year, 3, 2);
  const firstSundayNov = nthSunday(year, 11, 1);
  const day = new Date(Date.UTC(y, m - 1, d));
  if (day >= secondSundayMarch && day < firstSundayNov) return -5;
  return -6;
}

function nthSunday(year: number, month1: number, n: number): Date {
  // month1 = 1-based month; returns nth Sunday of that month as UTC midnight
  const d = new Date(Date.UTC(year, month1 - 1, 1));
  const firstSundayOffset = (7 - d.getUTCDay()) % 7;
  return new Date(Date.UTC(year, month1 - 1, 1 + firstSundayOffset + 7 * (n - 1)));
}

function formatOffset(hours: number): string {
  const sign = hours >= 0 ? "+" : "-";
  const abs = Math.abs(hours);
  const hh = String(Math.floor(abs)).padStart(2, "0");
  return `${sign}${hh}:00`;
}

export async function loadInternalLocations() {
  const supa = db();
  // Internal placeholder locations — pulled from recent jobs that hit the On-Call
  // customer + any other future internal IDs. Dedupes by address_id.
  const { data } = await supa
    .from("hcp_jobs_raw")
    .select("hcp_customer_id, raw")
    .eq("hcp_customer_id", "cus_051289f5b070471bbbe475ddc9e60a18")
    .order("scheduled_start", { ascending: false })
    .limit(50);

  type Loc = { customer_id: string; address_id: string; street: string; city: string };
  const seen = new Set<string>();
  const locs: Loc[] = [];
  for (const r of (data ?? []) as Array<{ hcp_customer_id: string; raw: Record<string, unknown> }>) {
    const raw = r.raw ?? {};
    const addr = (raw["address"] ?? {}) as Record<string, unknown>;
    const aid = typeof addr["id"] === "string" ? addr["id"] : null;
    const street = typeof addr["street"] === "string" ? addr["street"] : "";
    const city = typeof addr["city"] === "string" ? addr["city"] : "";
    if (!aid || seen.has(aid)) continue;
    seen.add(aid);
    locs.push({ customer_id: r.hcp_customer_id, address_id: aid, street, city });
  }
  return locs;
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
