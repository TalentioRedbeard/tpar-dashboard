// /manage/timecards — timecard REVIEW grid (build plan 2026-07-13 section
// 2.4, read-only phase). The sync fn (hcp-timecard-sync) is THE watcher; this
// page is the reviewer. Zero writes anywhere: timecard_sync_days /
// timecard_sync_state are the sync's audit trail and its upserts would
// clobber anything we wrote. Adjudication verbs (Accept HCP / Keep app /
// Escalate) come with the timecard_reviews table in the next phase — a
// conflict today routes to Danny with this page's side-by-side (decision #9).
// NOT payroll-of-record until 12 consecutive clean weeks (decision #2,
// earliest ≈ Oct 5, 2026) — this grid is how those weeks get proven.

import Link from "next/link";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Timecards · Manage · TPAR-DB" };

const CHI = "America/Chicago";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type HcpPair = { in: string | null; out: string | null };
type ConflictItem = { entry_id?: string; kind?: string; app_ts_chicago?: string; reason?: string };
type SyncDay = {
  tech_short_name: string;
  work_date: string;
  status: string;
  hcp_pairs: HcpPair[] | null;
  conflicts: ConflictItem[] | null;
  inserted_n: number;
  updated_n: number;
  voided_n: number;
  synced_at: string;
};
type SyncState = {
  tech_short_name: string;
  last_synced_at: string | null;
  last_ok: boolean | null;
  last_error: string | null;
};

function chiToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: CHI });
}
function weekSundayOf(iso: string): string {
  // Sunday-start pay week, matching HCP timecards and the sync.
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function pairHours(pairs: HcpPair[] | null): { hours: number; open: boolean } {
  let mins = 0;
  let open = false;
  for (const p of pairs ?? []) {
    if (!p.in) continue;
    if (!p.out) { open = true; continue; }
    const [ih, im] = p.in.split(":").map(Number);
    const [oh, om] = p.out.split(":").map(Number);
    const d = oh * 60 + om - (ih * 60 + im);
    if (Number.isFinite(d) && d > 0) mins += d;
  }
  return { hours: mins / 60, open };
}
function fmtHours(h: number): string {
  return h === 0 ? "—" : h.toFixed(h % 1 === 0 ? 0 : 1);
}
function fmtPair(p: HcpPair): string {
  return `${p.in ?? "?"}–${p.out ?? "(open)"}`;
}

// Status vocabulary is the sync's, rendered dynamically with a fallback so a
// new status from the timecard session shows up honestly instead of breaking.
const STATUS_META: Record<string, { cell: string; dot: string; label: string }> = {
  in_sync:   { cell: "bg-emerald-50 text-emerald-900", dot: "✓",  label: "In sync" },
  corrected: { cell: "bg-sky-50 text-sky-900",         dot: "≈",  label: "Corrected to HCP" },
  conflict:  { cell: "bg-red-50 text-red-900",         dot: "⚠️", label: "Conflict — needs a human" },
};
function statusMeta(s: string) {
  return STATUS_META[s] ?? { cell: "bg-amber-50 text-amber-900", dot: "?", label: `Unknown status: ${s}` };
}

export default async function ManageTimecardsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const sp = await searchParams;
  const requested = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? (sp.week as string) : chiToday();
  const weekStart = weekSundayOf(requested);
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const currentWeek = weekSundayOf(chiToday());

  const supa = db();
  const [daysRes, stateRes] = await Promise.all([
    supa
      .from("timecard_sync_days")
      .select("tech_short_name, work_date, status, hcp_pairs, conflicts, inserted_n, updated_n, voided_n, synced_at")
      .gte("work_date", weekStart)
      .lte("work_date", weekEnd)
      .order("work_date", { ascending: true }),
    supa.from("timecard_sync_state").select("tech_short_name, last_synced_at, last_ok, last_error"),
  ]);
  const rows = (daysRes.data ?? []) as SyncDay[];
  const states = ((stateRes.data ?? []) as SyncState[]).sort((a, b) =>
    a.tech_short_name.localeCompare(b.tech_short_name),
  );

  // Roster = the sync's full roster (state rows), plus anyone who has day
  // rows this week but no state row yet.
  const techs = [...new Set([...states.map((s) => s.tech_short_name), ...rows.map((r) => r.tech_short_name)])].sort();
  const byTechDay = new Map<string, SyncDay>();
  for (const r of rows) byTechDay.set(`${r.tech_short_name}|${r.work_date}`, r);

  const conflictDays = rows.filter((r) => r.status === "conflict");
  const staleStates = states.filter(
    (s) => !s.last_ok || !s.last_synced_at || Date.now() - new Date(s.last_synced_at).getTime() > 12 * 3600_000,
  );
  const lastSync = states.reduce<string | null>(
    (m, s) => (s.last_synced_at && (!m || s.last_synced_at > m) ? s.last_synced_at : m),
    null,
  );

  return (
    <PageShell
      icon="🕐"
      title="Timecard review"
      description={`HCP is the timesheet of record; the sync heals the app to it 3×/day and this grid shows the evidence. Week of ${weekStart}. Review-only — not payroll-of-record until 12 consecutive clean weeks.`}
      backHref="/manage"
      backLabel="Manage"
    >
      {/* Health strip — display only, straight from timecard_sync_state. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-xs">
        <span className={`font-semibold ${staleStates.length ? "text-amber-700" : "text-emerald-700"}`}>
          {staleStates.length ? `⚠️ ${staleStates.length} tech${staleStates.length > 1 ? "s" : ""} stale or erroring` : "✓ Sync healthy"}
        </span>
        <span className="text-neutral-400">·</span>
        <span className="text-neutral-500">
          last sync {lastSync ? new Date(lastSync).toLocaleString("en-US", { timeZone: CHI, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never"}
        </span>
        {staleStates.map((s) => (
          <span key={s.tech_short_name} className="rounded-md bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
            {s.tech_short_name}: {s.last_error ?? (s.last_synced_at ? "stale" : "never synced")}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <Link href={`/manage/timecards?week=${addDays(weekStart, -7)}`} className="rounded-md border border-neutral-300 bg-white px-2 py-1 font-medium text-neutral-700 hover:bg-neutral-50">← prev week</Link>
          {weekStart !== currentWeek ? (
            <Link href="/manage/timecards" className="rounded-md border border-neutral-300 bg-white px-2 py-1 font-medium text-neutral-700 hover:bg-neutral-50">this week</Link>
          ) : null}
          {weekStart < currentWeek ? (
            <Link href={`/manage/timecards?week=${addDays(weekStart, 7)}`} className="rounded-md border border-neutral-300 bg-white px-2 py-1 font-medium text-neutral-700 hover:bg-neutral-50">next week →</Link>
          ) : null}
        </span>
      </div>

      {/* The tech × day grid. Cell = the sync's verdict for that tech-day. */}
      <div className="overflow-x-auto rounded-2xl border-2 border-neutral-300 bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-[10px] font-bold uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2">Tech</th>
              {days.map((d, i) => (
                <th key={d} className={`px-2 py-2 text-center ${d === chiToday() ? "text-brand-800" : ""}`}>
                  {DOW[i]}
                  <span className="block font-normal normal-case text-neutral-400">{d.slice(5)}</span>
                </th>
              ))}
              <th className="px-3 py-2 text-right">Week</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {techs.map((tech) => {
              let weekHours = 0;
              let weekOpen = false;
              const cells = days.map((d) => {
                const row = byTechDay.get(`${tech}|${d}`);
                if (!row) return { d, row: null as SyncDay | null, hours: 0, open: false };
                const { hours, open } = pairHours(row.hcp_pairs);
                weekHours += hours;
                weekOpen = weekOpen || open;
                return { d, row, hours, open };
              });
              return (
                <tr key={tech}>
                  <td className="px-3 py-2 font-semibold text-neutral-900">{tech}</td>
                  {cells.map(({ d, row, hours, open }) => {
                    if (!row) return <td key={d} className="px-2 py-2 text-center text-neutral-300">·</td>;
                    const meta = statusMeta(row.status);
                    const isConflict = row.status === "conflict";
                    return (
                      <td key={d} className="p-1 text-center align-top">
                        <details className={`group rounded-lg ${meta.cell}`} title={meta.label}>
                          <summary className="cursor-pointer list-none px-1.5 py-1.5 [&::-webkit-details-marker]:hidden">
                            <span className="block text-sm font-semibold">
                              {meta.dot} {fmtHours(hours)}{open ? "+" : ""}
                            </span>
                          </summary>
                          {/* The side-by-side card: HCP punches vs what disagreed. */}
                          <div className="border-t border-black/5 px-2 py-1.5 text-left text-[11px]">
                            <div className="font-semibold">{meta.label}</div>
                            <div className="mt-1">
                              <span className="font-medium">HCP:</span>{" "}
                              {(row.hcp_pairs ?? []).length ? (row.hcp_pairs ?? []).map(fmtPair).join(", ") : "no punches"}
                            </div>
                            {isConflict ? (
                              <div className="mt-1 space-y-0.5">
                                {(row.conflicts ?? []).map((c, i) => (
                                  <div key={i}>
                                    <span className="font-medium">App {c.kind ?? "?"} {c.app_ts_chicago ?? "?"}:</span> {c.reason ?? "unmatched"}
                                  </div>
                                ))}
                                <div className="mt-1 font-medium">→ Bring to Danny with this side-by-side.</div>
                              </div>
                            ) : null}
                            {row.inserted_n + row.updated_n + row.voided_n > 0 ? (
                              <div className="mt-1 text-neutral-600">
                                sync healed: {row.inserted_n} added · {row.updated_n} corrected · {row.voided_n} voided
                              </div>
                            ) : null}
                          </div>
                        </details>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-bold text-neutral-900">
                    {fmtHours(weekHours)}{weekOpen ? "+" : ""}
                  </td>
                </tr>
              );
            })}
            {techs.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-neutral-500">
                  No sync data for this week yet — the sync started 2026-07-13 and runs 3×/day.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <span><span className="text-emerald-700">✓</span> in sync</span>
        <span><span className="text-sky-700">≈</span> corrected to HCP</span>
        <span><span className="text-red-700">⚠️</span> conflict — needs a human</span>
        <span>· hours from HCP punches, Chicago time; “+” = shift still open</span>
        <span>· click any cell for its detail card</span>
      </div>

      {conflictDays.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-semibold">{conflictDays.length} conflict day{conflictDays.length > 1 ? "s" : ""} this week:</span>{" "}
          {conflictDays.map((c) => `${c.tech_short_name} ${c.work_date}`).join(" · ")} — conflicts route to Danny with the
          side-by-side; adjudication verbs land here in the next phase.
        </div>
      ) : null}
    </PageShell>
  );
}
