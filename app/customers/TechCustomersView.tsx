// /customers tech-scoped view — every customer that pertains to work this
// tech was ON (canonical scope rule, Danny 2026-07-16: full history, crew
// counts, matched by hcp_employee_id). The leadership list exposes lifetime
// revenue + outstanding AR + every customer's PII; this shows only the tech's
// own customers, with contact info to do the job, and REDACTS the company
// financials. Scope arms: appointments_master.tech_all_ids (dispatch truth,
// upcoming included) ∪ jobs_master.assigned_employees (history to 2021).
// Contact from customer_360. Rendered from /customers when the viewer is a tech.

import Link from "next/link";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { assignedHasEmployee } from "@/lib/assigned-employees";

const CHI = "America/Chicago";

type ApptLite = {
  hcp_customer_id: string | null;
  customer_name: string | null;
  scheduled_start: string;
};
type Cust = { hcp_customer_id: string; name: string | null; phone10: string | null; phone_mobile10: string | null };

function fmtPhone(p: string | number | null): string | null {
  // customer_360 phone10 arrives as a NUMBER for some (older) rows — the
  // full-history list surfaced them and `Number.replace` crashed the page.
  if (p == null || p === "") return null;
  const d = String(p).replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return String(p);
}
function fmtDay(s: string): string {
  return new Date(s).toLocaleDateString("en-US", { timeZone: CHI, month: "short", day: "numeric" });
}

export async function TechCustomersView({ hcpEmployeeId, shortName }: { hcpEmployeeId: string | null; shortName: string }) {
  const supa = db();

  // Full work history, matched by hcp_employee_id — the canonical scope rule
  // (Danny 2026-07-16: every customer that pertains to work they were on;
  // crew counts). The old view was appointment-derived, NAME-matched, and
  // capped at 90 days — techs couldn't even FIND older customers to open
  // (Landon: jobs back to 2021; appointments only exist since 2024-06).
  const apptCount = new Map<string, number>();
  const lastSeen = new Map<string, string>();
  const nameByCust = new Map<string, string>();
  if (hcpEmployeeId) {
    // Arm 1: appointments (dispatch truth; also covers upcoming visits).
    const { data: appts } = await supa
      .from("appointments_master")
      .select("hcp_customer_id, customer_name, scheduled_start")
      .is("deleted_at", null)
      .contains("tech_all_ids", [hcpEmployeeId])
      .order("scheduled_start", { ascending: false })
      .limit(2000);
    for (const a of (appts ?? []) as ApptLite[]) {
      if (!a.hcp_customer_id) continue;
      apptCount.set(a.hcp_customer_id, (apptCount.get(a.hcp_customer_id) ?? 0) + 1);
      if (!lastSeen.has(a.hcp_customer_id) || a.scheduled_start > lastSeen.get(a.hcp_customer_id)!) {
        lastSeen.set(a.hcp_customer_id, a.scheduled_start);
      }
      if (a.customer_name && !nameByCust.has(a.hcp_customer_id)) nameByCust.set(a.hcp_customer_id, a.customer_name);
    }
    // Arm 2: the job record (history to 2021 — predates appointment sync).
    const { data: jmRows } = await supa
      .from("jobs_master")
      .select("hcp_customer_id, customer_name, assigned_employees, job_scheduled_start_date")
      .like("assigned_employees", `%${hcpEmployeeId}%`)
      .not("hcp_customer_id", "is", null)
      .limit(2000);
    for (const j of (jmRows ?? []) as Array<{ hcp_customer_id: string | null; customer_name: string | null; assigned_employees: string | null; job_scheduled_start_date: string | null }>) {
      if (!j.hcp_customer_id || !assignedHasEmployee(j.assigned_employees, hcpEmployeeId)) continue;
      if (!apptCount.has(j.hcp_customer_id)) apptCount.set(j.hcp_customer_id, 0);
      const d = j.job_scheduled_start_date ?? "";
      if (d && (!lastSeen.has(j.hcp_customer_id) || d > lastSeen.get(j.hcp_customer_id)!)) {
        lastSeen.set(j.hcp_customer_id, d);
      }
      if (j.customer_name && !nameByCust.has(j.hcp_customer_id)) nameByCust.set(j.hcp_customer_id, j.customer_name);
    }
  }
  const ids = [...apptCount.keys()].sort((a, b) => (lastSeen.get(b) ?? "").localeCompare(lastSeen.get(a) ?? ""));

  const byId = new Map<string, Cust>();
  // Chunked: full-history sets run 250+ ids — one giant .in() overruns URL limits.
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supa
      .from("customer_360")
      .select("hcp_customer_id, name, phone10, phone_mobile10")
      .in("hcp_customer_id", ids.slice(i, i + 100));
    for (const c of (data ?? []) as Cust[]) byId.set(c.hcp_customer_id, c);
  }

  return (
    <PageShell
      title="My customers"
      description={`Every customer from your work history · ${shortName}`}
      help={{
        intent: "The customers you've worked for — full history, upcoming included — with their phone to call ahead. Tap a name for their full record. Only your customers; company revenue/AR isn't shown here.",
        actions: [
          "Scoped to work you were on (lead or crew), all-time.",
          "Tap a name to open their record (history, notes, comms).",
          "Tap a phone number to call.",
        ],
      }}
    >
      {!hcpEmployeeId ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your HCP profile isn&apos;t linked yet, so we can&apos;t find your customers. Ask Danny to link your HCP employee id in the tech directory.
        </div>
      ) : ids.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
          No customers found for your work yet. <Link href="/schedule" className="underline">My schedule →</Link>
        </div>
      ) : (
        <>
          <div className="mb-3 text-xs text-neutral-500">{ids.length} customer{ids.length === 1 ? "" : "s"} from your work</div>
          <ul className="space-y-2">
            {ids.map((id) => {
              const c = byId.get(id);
              const name = c?.name ?? nameByCust.get(id) ?? "—";
              const phone = fmtPhone(c?.phone_mobile10 ?? c?.phone10 ?? null);
              const rawPhone = String(c?.phone_mobile10 ?? c?.phone10 ?? "").replace(/\D/g, "");
              const n = apptCount.get(id) ?? 0;
              const seen = lastSeen.get(id);
              return (
                <li key={id} className="flex items-start justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/customer/${id}`} className="truncate text-sm font-medium text-neutral-900 hover:underline">{name}</Link>
                    <div className="mt-0.5 text-xs text-neutral-500">
                      {n > 0 ? `${n} appointment${n === 1 ? "" : "s"} with you` : "from your job history"}{seen ? ` · latest ${fmtDay(seen)}` : ""}
                    </div>
                  </div>
                  {phone ? (
                    <a href={`tel:${rawPhone}`} className="shrink-0 whitespace-nowrap rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-neutral-50">📞 {phone}</a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </PageShell>
  );
}
