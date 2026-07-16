// /me/timecard — a tech's own pay week, read straight from the SAME source
// /manage/timecards reviews: timecard_sync_days (HCP punch truth, synced by
// hcp-timecard-sync). READ-ONLY by law (plan section 2.4): the sync's upserts
// would clobber anything written here, and payroll adjudication is a human
// verb on /manage. "Something wrong?" routes to the flag flow with the same
// entity key managers use, so both land on one queue entry.
//
// Scope = identity: timecard_sync_days.hcp_employee_id === me.tech.hcp_employee_id
// (never tech_short_name — second-Chris rule). Deliberately getCurrentTech, not
// requireSelf: requireSelf blocks view-as, and leadership previewing a tech
// SHOULD see that tech's week (the cookie already swaps me.tech).

import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "../../../lib/supabase";
import { getCurrentTech } from "../../../lib/current-tech";
import { PageShell } from "../../../components/PageShell";
import { FlagButton } from "../../../components/FlagButton";
import { EntityFlags } from "../../../components/EntityFlags";
import {
  CHI,
  DOW,
  type HcpPair,
  chiToday,
  weekSundayOf,
  addDays,
  pairHours,
  fmtHours,
  fmtPair,
} from "../../../lib/timecard-week";

export const metadata = { title: "My timecard · TPAR-DB" };
export const dynamic = "force-dynamic";

type SyncDay = {
  work_date: string;
  status: string;
  hcp_pairs: HcpPair[] | null;
  synced_at: string;
};

function fmtDayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${d.toLocaleDateString("en-US", { timeZone: "UTC", month: "numeric", day: "numeric" })}`;
}

export default async function MyTimecardPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/me/timecard");
  const tech = me.tech;
  if (!tech) redirect("/me"); // signed in but not a tech (office) → home

  const empId = tech.hcp_employee_id;
  const sp = await searchParams;
  const requested = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? (sp.week as string) : chiToday();
  const weekStart = weekSundayOf(requested);
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = chiToday();
  const currentWeek = weekSundayOf(today);

  let rows: SyncDay[] = [];
  let lastSyncedAt: string | null = null;
  if (empId) {
    const supa = db();
    const [daysRes, stateRes] = await Promise.all([
      supa
        .from("timecard_sync_days")
        .select("work_date, status, hcp_pairs, synced_at")
        .eq("hcp_employee_id", empId)
        .gte("work_date", weekStart)
        .lte("work_date", weekEnd)
        .order("work_date", { ascending: true }),
      supa
        .from("timecard_sync_state")
        .select("last_synced_at")
        .eq("hcp_employee_id", empId)
        .maybeSingle(),
    ]);
    rows = (daysRes.data ?? []) as SyncDay[];
    const rowMax = rows.reduce<string | null>((m, r) => (!m || r.synced_at > m ? r.synced_at : m), null);
    lastSyncedAt = rowMax ?? ((stateRes.data?.last_synced_at as string | null) ?? null);
  }

  const byDay = new Map(rows.map((r) => [r.work_date, r]));
  const dayTotals = days.map((d) => pairHours(byDay.get(d)?.hcp_pairs ?? null));
  const weekHours = dayTotals.reduce((s, t) => s + t.hours, 0);
  const anyOpen = dayTotals.some((t) => t.open);

  return (
    <PageShell
      kicker="My day"
      title="My timecard"
      description="Your punches this pay week, exactly as they stand in HCP. Read-only — if something's off, flag the day and management sorts it."
      backHref="/me"
      backLabel="← My day"
      help={{
        intent: "Your hours this pay week — same numbers management and payroll see.",
        actions: [
          "Week runs Sunday–Saturday, matching HCP.",
          "Each row shows your punch pairs and the day's total; the bottom line is the week.",
          "A day look wrong? Hit 🚩 on that row and say what happened — it lands on management's queue.",
          "‹ Prev week / Next week › to check an older week.",
        ],
        stuck: "Numbers lag up to a few hours behind HCP (see the \"as of\" stamp). If a punch you JUST made isn't here yet, that's the lag, not a loss.",
      }}
    >
      {!empId ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Your profile isn&rsquo;t linked to an HCP employee yet, so there&rsquo;s no timecard to show — ask Danny.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Week nav */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href={`/me/timecard?week=${addDays(weekStart, -7)}`}
              className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-neutral-700 hover:bg-neutral-50"
            >
              ‹ Prev week
            </Link>
            <span className="font-medium text-neutral-900">
              Week of {new Date(`${weekStart}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}
              {weekStart === currentWeek ? " (this week)" : ""}
            </span>
            {weekStart < currentWeek ? (
              <Link
                href={`/me/timecard?week=${addDays(weekStart, 7)}`}
                className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-neutral-700 hover:bg-neutral-50"
              >
                Next week ›
              </Link>
            ) : null}
          </div>

          {/* Outcomes of anything this tech flagged from here */}
          <EntityFlags entityType="timecard_day" entityId={`${empId}:`} prefix />

          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <tbody>
                {days.map((d, i) => {
                  const row = byDay.get(d);
                  const t = dayTotals[i];
                  const isToday = d === today;
                  const future = d > today;
                  return (
                    <tr key={d} className={`border-b border-neutral-100 last:border-0 ${isToday ? "bg-brand-50/50" : ""}`}>
                      <td className="w-24 px-3 py-2.5 font-medium text-neutral-900">
                        {fmtDayLabel(d)}
                        {isToday ? <span className="ml-1 text-[10px] font-semibold uppercase text-brand-600">today</span> : null}
                      </td>
                      <td className="px-3 py-2.5 text-neutral-700">
                        {future ? (
                          <span className="text-neutral-300">—</span>
                        ) : row && (row.hcp_pairs?.length ?? 0) > 0 ? (
                          <span className="tabular-nums">{(row.hcp_pairs ?? []).map(fmtPair).join(" · ")}</span>
                        ) : (
                          <span className="text-neutral-400">no punches</span>
                        )}
                        {row?.status === "conflict" ? (
                          <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                            ⚠️ needs review — management has it
                          </span>
                        ) : null}
                      </td>
                      <td className="w-20 px-3 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                        {future ? "" : `${fmtHours(t.hours)}${t.open ? "+" : ""}`}
                      </td>
                      <td className="w-16 px-2 py-2.5 text-right">
                        {!future && row ? (
                          <FlagButton
                            entityType="timecard_day"
                            entityId={`${empId}:${d}`}
                            entityLabel={`${tech.tech_short_name} · ${d}`}
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-neutral-200 bg-neutral-50">
                  <td className="px-3 py-2.5 font-semibold text-neutral-900">Week</td>
                  <td />
                  <td className="px-3 py-2.5 text-right text-base font-bold tabular-nums text-neutral-900">
                    {fmtHours(weekHours)}{anyOpen ? "+" : ""}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-neutral-500">
            {anyOpen ? "A “+” means a shift is still open (clocked in, not yet out). " : ""}
            as of{" "}
            {lastSyncedAt
              ? new Date(lastSyncedAt).toLocaleString("en-US", { timeZone: CHI, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
              : "—"}{" "}
            · synced from HCP 3×/day
          </p>
        </div>
      )}
    </PageShell>
  );
}
