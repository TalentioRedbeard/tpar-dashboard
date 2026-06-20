// Tech-scoped schedule — a field tech sees ONLY their own appointments
// ("what pertains to me"), as a simple day-grouped agenda. No dispatch grid,
// no other techs, no reschedule/drag controls. Rendered from /schedule when the
// viewer is a non-admin/non-manager tech (admin + manager get the full grid).
//
// LANDMINE: appointments_master tech columns are HCP FULL names
// (tech_primary_name / tech_all_names[]), NOT tech_short_name. We scope on the
// tech's hcp_full_name. Filtering is done in JS (not a PostgREST array-contains
// .or()) to avoid silent mis-quoting on names with spaces — correctness over a
// few hundred extra rows in a ~2-week window.
//
// total_amount is CENTS (money-units landmine) — divide by 100 for display.
// Showing a tech the $ on their OWN appointments is intentional ("a revenue
// picture for what they produced"); it is never company-wide here.

import Link from "next/link";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { fmtMoney } from "../../components/Table";
import { EstimateBadge } from "../../components/EstimateBadge";
import { getEstimatesForCards, estimatesForCard } from "../../lib/estimates-for-cards";

const CHI = "America/Chicago";

type Appt = {
  appointment_id: string | null;
  hcp_job_id: string | null;
  hcp_customer_id: string | null;
  hcp_estimate_id: string | null;
  appointment_type: string | null;
  scheduled_start: string;
  scheduled_end: string | null;
  status: string | null;
  tech_primary_name: string | null;
  tech_all_names: string[] | null;
  customer_name: string | null;
  street: string | null;
  city: string | null;
  total_amount: number | null;
};

function chicagoTodayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: CHI });
}
function keyToDate(key: string): Date {
  return new Date(`${key}T12:00:00-05:00`);
}
function shiftKey(key: string, days: number): string {
  const d = keyToDate(key);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toLocaleDateString("en-CA", { timeZone: CHI });
}
function chicagoDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: CHI });
}
function chicagoTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: CHI, hour: "numeric", minute: "2-digit" });
}
function dayHeading(key: string): string {
  return keyToDate(key).toLocaleDateString("en-US", { timeZone: CHI, weekday: "long", month: "long", day: "numeric" });
}
function rangeLabel(startKey: string, endKey: string): string {
  const fmt = (k: string) => keyToDate(k).toLocaleDateString("en-US", { timeZone: CHI, month: "short", day: "numeric" });
  return `${fmt(startKey)} – ${fmt(shiftKey(endKey, -1))}`;
}

function statusPill(status: string | null): { cls: string; label: string } {
  const s = (status ?? "").toLowerCase();
  if (s.includes("complete")) return { cls: "bg-emerald-100 text-emerald-800", label: "Complete" };
  if (s === "in progress" || s === "en route") return { cls: "bg-blue-100 text-blue-800", label: status ?? "In progress" };
  if (s.includes("cancel")) return { cls: "bg-red-50 text-red-700", label: status ?? "Canceled" };
  if (s === "scheduled" || s === "created job from estimate") return { cls: "bg-neutral-100 text-neutral-700", label: "Scheduled" };
  return { cls: "bg-neutral-100 text-neutral-700", label: status ?? "—" };
}

export async function TechScheduleView({
  fullName,
  shortName,
  centerKey: centerKeyParam,
}: {
  fullName: string | null;
  shortName: string;
  centerKey?: string;
}) {
  const todayKey = chicagoTodayKey();
  const centerKey = centerKeyParam && /^\d{4}-\d{2}-\d{2}$/.test(centerKeyParam) ? centerKeyParam : todayKey;

  // A clean 2-week agenda window starting at centerKey; ‹/› step ±14 days.
  const startKey = centerKey;
  const endKey = shiftKey(centerKey, 14);
  const startUtc = new Date(`${startKey}T00:00:00-05:00`).toISOString();
  const endUtc = new Date(`${endKey}T00:00:00-05:00`).toISOString();

  let appts: Appt[] = [];
  if (fullName) {
    const supa = db();
    const { data } = await supa
      .from("appointments_master")
      .select(
        "appointment_id, hcp_job_id, hcp_customer_id, hcp_estimate_id, appointment_type, scheduled_start, scheduled_end, status, tech_primary_name, tech_all_names, customer_name, street, city, total_amount",
      )
      .is("deleted_at", null)
      .gte("scheduled_start", startUtc)
      .lt("scheduled_start", endUtc)
      .order("scheduled_start", { ascending: true });
    appts = ((data ?? []) as Appt[]).filter(
      (a) => a.tech_primary_name === fullName || (a.tech_all_names ?? []).includes(fullName),
    );
  }

  // Group by Chicago day.
  const byDay = new Map<string, Appt[]>();
  for (const a of appts) {
    const k = chicagoDateKey(a.scheduled_start);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(a);
  }
  const dayKeys = [...byDay.keys()].sort();

  // Estimate badges — one batched RPC for the whole agenda window.
  const estMaps = await getEstimatesForCards(
    appts.map((a) => a.hcp_job_id),
    appts.map((a) => a.hcp_customer_id),
    6,
  );

  const navLink = (dateKey: string | null) => (dateKey ? `/schedule?date=${dateKey}` : "/schedule");

  return (
    <PageShell
      title="🗓️ My schedule"
      description={`${appts.length} appointment${appts.length === 1 ? "" : "s"} · ${rangeLabel(startKey, endKey)} · ${shortName}`}
      help={{
        intent: "Your scheduled appointments. Tap any one to open the job (start work, add an estimate, etc.).",
        actions: [
          "‹ Earlier / Later › step the window back and forward two weeks.",
          "Today is highlighted; tap an appointment to open its job.",
          "Only your own jobs show here — for today's quick actions use My day.",
        ],
      }}
    >
      <div className="mb-4 flex items-center gap-2">
        <Link href={navLink(shiftKey(centerKey, -14))} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">‹ Earlier</Link>
        {centerKey !== todayKey && (
          <Link href={navLink(null)} className="rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100">Today</Link>
        )}
        <Link href={navLink(shiftKey(centerKey, 14))} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">Later ›</Link>
        <Link href="/me" className="ml-auto rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">My day →</Link>
      </div>

      {!fullName ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your HCP name isn&apos;t linked yet, so we can&apos;t match your appointments. Ask Danny to set your HCP name in the tech directory.
        </div>
      ) : dayKeys.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
          No appointments in this window. Use ‹ Earlier / Later › to look around, or check <Link href="/me" className="underline">My day</Link>.
        </div>
      ) : (
        <div className="space-y-5">
          {dayKeys.map((k) => {
            const isToday = k === todayKey;
            const isPast = k < todayKey;
            return (
              <div key={k}>
                <div className={`mb-2 text-sm font-semibold ${isToday ? "text-amber-800" : isPast ? "text-neutral-400" : "text-neutral-800"}`}>
                  {dayHeading(k)}{isToday ? " · today" : ""}
                </div>
                <div className="space-y-2">
                  {byDay.get(k)!.map((a, i) => {
                    const pill = statusPill(a.status);
                    const dollars = (Number(a.total_amount) || 0) / 100;
                    const assisting = !!a.tech_primary_name && a.tech_primary_name !== fullName;
                    const cardEstimates = estimatesForCard(
                      estMaps,
                      a.hcp_job_id,
                      a.hcp_customer_id,
                      a.appointment_type === "estimate" ? a.hcp_estimate_id : null,
                    );
                    const body = (
                      <div className={`flex items-start justify-between gap-3 rounded-xl border bg-white px-3 py-2.5 ${isPast ? "border-neutral-200 opacity-70" : "border-neutral-200 hover:border-brand-300 hover:shadow-sm"}`}>
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-sm font-semibold text-neutral-900">{chicagoTime(a.scheduled_start)}</span>
                            <span className="truncate text-sm font-medium text-neutral-900">{a.customer_name ?? "—"}</span>
                          </div>
                          {a.street ? (
                            <div className="mt-0.5 truncate text-xs text-neutral-500">{a.street}{a.city ? `, ${a.city}` : ""}</div>
                          ) : null}
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${pill.cls}`}>{pill.label}</span>
                            {assisting ? <span className="text-[10px] text-neutral-400">assisting {a.tech_primary_name}</span> : null}
                            {cardEstimates.length > 0 ? <EstimateBadge estimates={cardEstimates} size="sm" /> : null}
                          </div>
                        </div>
                        {dollars > 0 ? <span className="shrink-0 text-sm font-semibold text-neutral-700">{fmtMoney(dollars)}</span> : null}
                      </div>
                    );
                    return a.hcp_job_id ? (
                      <Link key={a.appointment_id ?? i} href={`/job/${a.hcp_job_id}`} className="block">{body}</Link>
                    ) : a.appointment_type === "estimate" && a.appointment_id ? (
                      // Estimate appointment → draft a multi-option estimate from the visit.
                      <Link key={a.appointment_id} href={`/estimate/new?appointment=${a.appointment_id}`} className="block">{body}</Link>
                    ) : (
                      <div key={a.appointment_id ?? i}>{body}</div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
