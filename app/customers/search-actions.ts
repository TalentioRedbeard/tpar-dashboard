"use server";

// The customers-page interpreter (Danny 2026-07-16: "a dynamic description
// interpreter like I have for jobs") — the /find patterns pointed at the
// tech's OWN customer universe: keyword tokens ("current"/"today"), invoice
// and phone lookups, and free-text matching across customer names, job
// addresses, job descriptions, and HCP notes — each hit carries a REASON so
// the tech sees why it matched ("job notes: …replaced tankless…").
//
// Scope = the canonical work-scope rule (lib/tech-scope.ts): the tech's own
// jobs by hcp_employee_id (job record ∪ appointment crew), full history.
// Admin/manager pass through unscoped is NOT offered here — this action is
// the tech view's brain; leadership has the full customers list.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { assignedHasEmployee } from "@/lib/assigned-employees";

export type CustomerHit = {
  hcp_customer_id: string;
  name: string | null;
  reason: string;
  snippet: string | null;
  last_date: string | null;
};

const clean = (s: string) => s.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();

export async function searchMyCustomers(input: { q: string }): Promise<
  | { ok: true; hits: CustomerHit[] }
  | { ok: false; error: string }
> {
  const me = await getCurrentTech();
  if (!me?.tech) return { ok: false, error: "Not signed in as a tech." };
  const empId = me.tech.hcp_employee_id;
  if (!empId) return { ok: false, error: "Your HCP profile isn't linked yet — ask Danny." };

  const q = clean(input.q ?? "");
  if (!q) return { ok: true, hits: [] };
  const supa = db();
  const byId = new Map<string, CustomerHit>();
  const add = (id: string | null, name: string | null, reason: string, snippet: string | null, date: string | null, rank: number) => {
    if (!id) return;
    const existing = byId.get(id) as (CustomerHit & { rank?: number }) | undefined;
    if (existing && (existing.rank ?? 9) <= rank) return; // keep the best reason
    byId.set(id, { hcp_customer_id: id, name, reason, snippet, last_date: date, rank } as CustomerHit & { rank: number });
  };

  // ── keyword: "current" / "today" → today's schedule ────────────────────────
  if (/^(current|today|now|active)$/i.test(q)) {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const { data } = await supa
      .from("appointments_master")
      .select("hcp_customer_id, customer_name, scheduled_start")
      .is("deleted_at", null)
      .contains("tech_all_ids", [empId])
      .gte("scheduled_start", dayStart.toISOString())
      .lt("scheduled_start", dayEnd.toISOString());
    for (const a of (data ?? []) as Array<{ hcp_customer_id: string | null; customer_name: string | null; scheduled_start: string }>) {
      add(a.hcp_customer_id, a.customer_name, "on your schedule today", null, a.scheduled_start, 0);
    }
    return { ok: true, hits: finalize(byId) };
  }

  // ── digits: invoice # or phone ──────────────────────────────────────────────
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 7 && digits.length === q.replace(/[\s()-]/g, "").length) {
    const { data: jm } = await supa
      .from("jobs_master")
      .select("hcp_customer_id, customer_name, assigned_employees, hcp_invoice_number, job_scheduled_start_date")
      .like("assigned_employees", `%${empId}%`)
      .ilike("hcp_invoice_number", `${digits}%`)
      .limit(20);
    for (const j of (jm ?? []) as Array<Record<string, unknown>>) {
      if (!assignedHasEmployee(j.assigned_employees as string | null, empId)) continue;
      add(j.hcp_customer_id as string | null, j.customer_name as string | null,
        `invoice #${j.hcp_invoice_number}`, null, (j.job_scheduled_start_date as string | null), 0);
    }
    if (digits.length === 10) {
      const { data: c } = await supa
        .from("customer_360")
        .select("hcp_customer_id, name")
        .or(`phone10.eq.${digits},phone_mobile10.eq.${digits}`)
        .limit(5);
      for (const row of (c ?? []) as Array<{ hcp_customer_id: string; name: string | null }>) {
        // Only surface if it's HIS customer (scope check via jobs/appointments).
        if (await inScope(empId, row.hcp_customer_id)) {
          add(row.hcp_customer_id, row.name, "phone number match", null, null, 0);
        }
      }
    }
    if (byId.size) return { ok: true, hits: finalize(byId) };
  }

  // ── free text over HIS jobs: name · address · description · HCP notes ─────
  const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 3).slice(0, 4);
  const needles = [q, ...tokens.filter((t) => t !== q.toLowerCase())];
  const orArms = needles.flatMap((n) => [
    `customer_name.ilike.%${n}%`,
    `address.ilike.%${n}%`,
    `job_description.ilike.%${n}%`,
    `hcp_notes.ilike.%${n}%`,
  ]).join(",");

  const { data: jm } = await supa
    .from("jobs_master")
    .select("hcp_customer_id, customer_name, assigned_employees, address, job_description, hcp_notes, job_scheduled_start_date")
    .like("assigned_employees", `%${empId}%`)
    .or(orArms)
    .order("job_scheduled_start_date", { ascending: false, nullsFirst: false })
    .limit(150);

  const hitReason = (row: Record<string, unknown>): { reason: string; snippet: string | null; rank: number } | null => {
    const fields: Array<[string, string, number]> = [
      ["customer_name", "name", 1],
      ["address", "address", 2],
      ["job_description", "job description", 3],
      ["hcp_notes", "job notes", 3],
    ];
    for (const [col, label, rank] of fields) {
      const v = String(row[col] ?? "");
      const vLower = v.toLowerCase();
      const needle = needles.find((n) => vLower.includes(n.toLowerCase()));
      if (!needle) continue;
      let snippet: string | null = null;
      if (rank === 3) {
        const i = vLower.indexOf(needle.toLowerCase());
        snippet = `…${v.slice(Math.max(0, i - 40), i + needle.length + 40).replace(/\s+/g, " ").trim()}…`;
      } else if (rank === 2) {
        snippet = v;
      }
      return { reason: `matched ${label}`, snippet, rank };
    }
    return null;
  };

  for (const j of (jm ?? []) as Array<Record<string, unknown>>) {
    if (!assignedHasEmployee(j.assigned_employees as string | null, empId)) continue;
    const hit = hitReason(j);
    if (!hit) continue;
    add(j.hcp_customer_id as string | null, j.customer_name as string | null,
      hit.reason, hit.snippet, (j.job_scheduled_start_date as string | null), hit.rank);
  }

  // Appointment-only customers (no job-record row): name matches.
  const { data: appts } = await supa
    .from("appointments_master")
    .select("hcp_customer_id, customer_name, scheduled_start")
    .is("deleted_at", null)
    .contains("tech_all_ids", [empId])
    .ilike("customer_name", `%${q}%`)
    .order("scheduled_start", { ascending: false })
    .limit(20);
  for (const a of (appts ?? []) as Array<{ hcp_customer_id: string | null; customer_name: string | null; scheduled_start: string }>) {
    add(a.hcp_customer_id, a.customer_name, "matched name", null, a.scheduled_start, 1);
  }

  return { ok: true, hits: finalize(byId) };
}

async function inScope(empId: string, customerId: string): Promise<boolean> {
  const supa = db();
  const { data: jobs } = await supa
    .from("jobs_master").select("assigned_employees").eq("hcp_customer_id", customerId).limit(200);
  if ((jobs ?? []).some((j) => assignedHasEmployee(j.assigned_employees as string | null, empId))) return true;
  const { data: appt } = await supa
    .from("appointments_master").select("id").eq("hcp_customer_id", customerId)
    .contains("tech_all_ids", [empId]).limit(1).maybeSingle();
  return !!appt;
}

function finalize(byId: Map<string, CustomerHit>): CustomerHit[] {
  return [...byId.values()]
    .sort((a, b) => ((a as CustomerHit & { rank?: number }).rank ?? 9) - ((b as CustomerHit & { rank?: number }).rank ?? 9)
      || String(b.last_date ?? "").localeCompare(String(a.last_date ?? "")))
    .slice(0, 20)
    .map(({ hcp_customer_id, name, reason, snippet, last_date }) => ({ hcp_customer_id, name, reason, snippet, last_date }));
}
