// Day timeline (#24, Madisson 2026-06-01; per-tech rebuild 2026-06-02).
//
// Y = TECHNICIANS (one row each), X = 15-minute columns across the operating day.
// A JOB is a horizontal "lane" band that spans the rows of its crew and the time
// it is active (OMW → Finish); inside the band a center-line paints in lifecycle-
// state colors as triggers fire. Techs are ORDERED so that co-crew sit adjacent,
// so the board visibly regroups around shared work — that's Danny's original #24:
// "rearrange technicians vertically to neighbor other techs on the same job; that
// group gets a horizontal bar, their Job lane." Planned (scheduled, no triggers
// yet) renders faint and solidifies as the day fires, so it's useful before
// perfect button adoption and surfaces plan-vs-actual drift.
//
// Browse ANY day via ?date=YYYY-MM-DD (defaults to today). The now-line + 60s
// auto-refresh only apply when viewing today.

import { db } from "../../../lib/supabase";
import { redirect } from "next/navigation";
import { getCurrentTech } from "../../../lib/current-tech";
import { PageShell } from "../../../components/PageShell";
import { TechAvatar } from "../../../components/TechAvatar";
import { AutoRefresh } from "../../../components/AutoRefresh";
import { TimelineDayNav } from "../../../components/TimelineDayNav";
import { resolveTechColor } from "../../../lib/tech-colors";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Day timeline · TPAR-DB" };

const CHI = "America/Chicago";
const DAY_START = 6 * 60;   // 6:00am
const DAY_END = 20 * 60;    // 8:00pm
const SPAN = DAY_END - DAY_START;
const ROW_H = 46;
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Lifecycle trigger → lane state + center-line color. 1 (intake) is pre-job.
const STATE: Record<number, { label: string; color: string }> = {
  2: { label: "On my way", color: "#2563eb" },
  3: { label: "Started", color: "#f59e0b" },
  4: { label: "Estimating", color: "#8b5cf6" },
  5: { label: "Presenting", color: "#a855f7" },
  6: { label: "Finished", color: "#16a34a" },
  7: { label: "Collected", color: "#15803d" },
};
const PLANNED = "#cbd5e1"; // slate-300 — scheduled baseline

function offsetForYmd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((s) => parseInt(s, 10));
  const nth = (mon: number, n: number) => {
    const dt = new Date(Date.UTC(y, mon - 1, 1));
    const off = (7 - dt.getUTCDay()) % 7;
    return new Date(Date.UTC(y, mon - 1, 1 + off + 7 * (n - 1)));
  };
  const day = new Date(Date.UTC(y, m - 1, d));
  return day >= nth(3, 2) && day < nth(11, 1) ? -5 : -6;
}
function fmtOff(h: number): string { return `${h >= 0 ? "+" : "-"}${String(Math.abs(h)).padStart(2, "0")}:00`; }

// Minute-of-day in Chicago for an ISO instant.
function chiMin(iso: string): number {
  const s = new Date(iso).toLocaleTimeString("en-GB", { timeZone: CHI, hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}
function chiClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: CHI, hour: "numeric", minute: "2-digit" });
}
const pct = (min: number) => Math.max(0, Math.min(100, ((min - DAY_START) / SPAN) * 100));

type Seg = { startMin: number; endMin: number; color: string; label: string; planned: boolean };

export default async function DayTimelinePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/dispatch/today");
  if (!me.isAdmin && !me.isManager) redirect("/me");
  const supa = db();
  const params = await searchParams;

  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: CHI });
  const dateKey = params.date && VALID_DATE.test(params.date) ? params.date : todayKey;
  const isToday = dateKey === todayKey;

  const startUtc = new Date(`${dateKey}T00:00:00${fmtOff(offsetForYmd(dateKey))}`).toISOString();
  const endUtc = new Date(new Date(startUtc).getTime() + 24 * 3600 * 1000).toISOString();
  const nowIso = new Date().toISOString();
  const nowMin = chiMin(nowIso);

  const [hy, hm, hd] = dateKey.split("-").map(Number);
  const humanDate = new Date(Date.UTC(hy, hm - 1, hd)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

  const [apptRes, lifeRes, techRes] = await Promise.all([
    supa.from("appointments_master")
      .select("appointment_id, hcp_job_id, scheduled_start, scheduled_end, status, tech_primary_name, tech_all_names, customer_name, invoice_number")
      .is("deleted_at", null)
      .gte("scheduled_start", startUtc).lt("scheduled_start", endUtc)
      .not("status", "in", "(canceled,Canceled,cancelled,Cancelled,pro canceled,user canceled)")
      .order("scheduled_start", { ascending: true }),
    supa.from("job_lifecycle_events")
      .select("hcp_job_id, trigger_number, fired_at")
      .gte("fired_at", startUtc).lt("fired_at", endUtc),
    supa.from("tech_directory")
      .select("hcp_full_name, tech_short_name, avatar_url, color_hex, is_lead")
      .eq("is_active", true).neq("is_test", true),
  ]);

  const appts = (apptRes.data ?? []) as Array<{
    appointment_id: string | null; hcp_job_id: string | null; scheduled_start: string; scheduled_end: string | null;
    status: string | null; tech_primary_name: string | null; tech_all_names: string[] | null;
    customer_name: string | null; invoice_number: string | null;
  }>;
  const techs = (techRes.data ?? []) as Array<{ hcp_full_name: string; tech_short_name: string; avatar_url: string | null; color_hex: string | null; is_lead: boolean | null }>;

  const colorByFull = new Map<string, string | null>(techs.map((t) => [t.hcp_full_name, t.color_hex ?? null]));
  const avatarByFull = new Map<string, string | null>(techs.map((t) => [t.hcp_full_name, t.avatar_url ?? null]));
  const shortByFull = new Map<string, string>(techs.map((t) => [t.hcp_full_name, t.tech_short_name]));
  const leadSet = new Set(techs.filter((t) => t.is_lead).map((t) => t.hcp_full_name));

  const lifeByJob = new Map<string, Array<{ trigger_number: number; fired_at: string }>>();
  for (const e of (lifeRes.data ?? []) as Array<{ hcp_job_id: string | null; trigger_number: number; fired_at: string }>) {
    if (!e.hcp_job_id) continue;
    if (!lifeByJob.has(e.hcp_job_id)) lifeByJob.set(e.hcp_job_id, []);
    lifeByJob.get(e.hcp_job_id)!.push({ trigger_number: e.trigger_number, fired_at: e.fired_at });
  }

  // One JOB per appointment, with its status segments + the crew it touches.
  type Job = {
    hcp_job_id: string | null; appointment_id: string | null; customer: string | null;
    crewFull: string[]; segs: Seg[]; startMin: number; endMin: number; curState: string; curColor: string;
  };
  const jobs: Job[] = appts.map((a) => {
    const members = (a.tech_all_names && a.tech_all_names.length ? a.tech_all_names : (a.tech_primary_name ? [a.tech_primary_name] : []))
      .filter((n): n is string => !!n);
    const primary = a.tech_primary_name ?? null;
    const leadFull = (primary && leadSet.has(primary)) ? primary : members.find((m) => leadSet.has(m)) ?? primary ?? members[0] ?? null;
    const crewFull = [...new Set([leadFull, ...members].filter((n): n is string => !!n))];

    const schedStart = chiMin(a.scheduled_start);
    const schedEnd = a.scheduled_end ? chiMin(a.scheduled_end) : schedStart + 60;
    const evs = (lifeByJob.get(a.hcp_job_id ?? "") ?? [])
      .filter((e) => e.trigger_number >= 2 && e.trigger_number <= 7)
      .sort((x, y) => (x.fired_at < y.fired_at ? -1 : 1));

    const segs: Seg[] = [];
    if (evs.length === 0) {
      segs.push({ startMin: schedStart, endMin: Math.max(schedEnd, schedStart + 10), color: PLANNED, label: "Scheduled", planned: true });
    } else {
      const firstMin = chiMin(evs[0].fired_at);
      if (schedStart < firstMin) segs.push({ startMin: schedStart, endMin: firstMin, color: PLANNED, label: "Scheduled (waiting)", planned: true });
      for (let i = 0; i < evs.length; i++) {
        const t = evs[i].trigger_number;
        const st = STATE[t];
        if (!st) continue;
        const s = chiMin(evs[i].fired_at);
        const terminal = t === 6 || t === 7;
        // An open (non-terminal) last state runs to "now" on today, else to the
        // scheduled end (past days have no live cursor).
        let e2 = i < evs.length - 1 ? chiMin(evs[i + 1].fired_at) : (terminal ? s + 8 : (isToday ? nowMin : Math.max(schedEnd, s + 20)));
        if (e2 < s) e2 = s + 8;
        segs.push({ startMin: s, endMin: e2, color: st.color, label: `${st.label} ${chiClock(evs[i].fired_at)}`, planned: false });
      }
    }
    const lastEv = evs[evs.length - 1];
    const curState = lastEv ? (STATE[lastEv.trigger_number]?.label ?? "Scheduled") : "Scheduled";
    const curColor = lastEv ? (STATE[lastEv.trigger_number]?.color ?? PLANNED) : PLANNED;
    return { hcp_job_id: a.hcp_job_id, appointment_id: a.appointment_id, customer: a.customer_name, crewFull, segs, startMin: segs[0].startMin, endMin: segs[segs.length - 1].endMin, curState, curColor };
  });

  // Order techs so co-crew land adjacent: walk jobs in start order, append each
  // job's crew the first time we see them. A multi-tech job thus clusters its
  // members; the board regroups around shared work.
  const order: string[] = [];
  const seen = new Set<string>();
  for (const j of [...jobs].sort((a, b) => a.startMin - b.startMin)) {
    for (const f of j.crewFull) if (!seen.has(f)) { seen.add(f); order.push(f); }
  }
  const rowIndex = new Map(order.map((f, i) => [f, i] as const));
  const nRows = order.length;

  const rows = order.map((full) => ({
    full,
    short: shortByFull.get(full) ?? full.split(" ")[0],
    avatarUrl: avatarByFull.get(full) ?? null,
    colorHex: colorByFull.get(full) ?? null,
    isLead: leadSet.has(full),
  }));

  // Attach each job's row-span (min..max crew row) so a job draws as one band.
  const bands = jobs.map((j) => {
    const idxs = j.crewFull.map((f) => rowIndex.get(f)).filter((i): i is number => i != null).sort((a, b) => a - b);
    const rowStart = idxs.length ? idxs[0] : 0;
    const rowEnd = idxs.length ? idxs[idxs.length - 1] : 0;
    return { ...j, rowStart, rowCount: rowEnd - rowStart + 1, leadColor: j.crewFull[0] ? resolveTechColor(j.crewFull[0], colorByFull) : "#94a3b8" };
  });

  const hours: number[] = [];
  for (let h = DAY_START / 60; h <= DAY_END / 60; h++) hours.push(h);
  const quarters: number[] = [];
  for (let m = DAY_START; m <= DAY_END; m += 15) quarters.push(m);
  const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "a" : "p"}`;
  const showNow = isToday && nowMin >= DAY_START && nowMin <= DAY_END;

  return (
    <PageShell
      kicker="Dispatch"
      title="📊 Day timeline"
      description="Each tech is a row; a job is a lane spanning its crew, painted by lifecycle triggers (faint = scheduled, solid = actual). Browse any day; today updates every 60s."
      backHref="/dispatch"
      backLabel="Dispatch"
    >
      {isToday ? <AutoRefresh seconds={60} /> : null}

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <TimelineDayNav date={dateKey} isToday={isToday} />
        <span className="text-sm font-semibold text-neutral-800">{humanDate}</span>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-600">
          <span className="font-semibold uppercase tracking-wide text-neutral-500">States</span>
          {[2, 3, 4, 5, 6, 7].map((t) => (
            <span key={t} className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-4 rounded-sm" style={{ backgroundColor: STATE[t].color }} />
              {STATE[t].label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm opacity-40" style={{ backgroundColor: PLANNED }} /> scheduled</span>
        </div>
      </div>

      {nRows === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          No jobs scheduled for {humanDate}.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <div style={{ minWidth: 980 }}>
            {/* time axis */}
            <div className="flex border-b border-neutral-200 bg-neutral-50/60">
              <div className="w-44 shrink-0 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Technician</div>
              <div className="relative flex-1 h-6">
                {hours.map((h) => (
                  <span key={h} className="absolute top-0 -translate-x-1/2 text-[10px] text-neutral-400" style={{ left: `${pct(h * 60)}%` }}>{hourLabel(h)}</span>
                ))}
              </div>
            </div>

            {/* body: tech gutter + a single relative canvas the job-bands paint onto */}
            <div className="flex">
              <div className="w-44 shrink-0">
                {rows.map((r) => (
                  <div key={r.full} className="flex items-center gap-1.5 border-b border-neutral-100 px-2" style={{ height: ROW_H }}>
                    <TechAvatar shortName={r.short} avatarUrl={r.avatarUrl} colorHex={r.colorHex} size={22} />
                    <span className="truncate text-xs font-medium text-neutral-800">{r.short}{r.isLead ? <span className="ml-1 text-[9px] text-amber-500" title="Lead">★</span> : null}</span>
                  </div>
                ))}
              </div>

              <div className="relative flex-1" style={{ height: nRows * ROW_H }}>
                {/* row stripes */}
                {rows.map((r, i) => (
                  <div key={r.full} className={`absolute inset-x-0 border-b border-neutral-100 ${i % 2 ? "bg-neutral-50/40" : ""}`} style={{ top: i * ROW_H, height: ROW_H }} />
                ))}
                {/* 15-min + hour gridlines */}
                {quarters.map((m) => (
                  <div key={m} className="absolute top-0 bottom-0 w-px" style={{ left: `${pct(m)}%`, backgroundColor: m % 60 === 0 ? "#e2e8f0" : "#f1f5f9" }} />
                ))}
                {/* now line */}
                {showNow ? (
                  <div className="absolute top-0 bottom-0 w-px bg-rose-400/70 z-20" style={{ left: `${pct(nowMin)}%` }} title={`now ${chiClock(nowIso)}`} />
                ) : null}

                {/* job lanes — one band per job spanning its crew's rows */}
                {bands.map((b, bi) => {
                  const top = b.rowStart * ROW_H + 5;
                  const height = b.rowCount * ROW_H - 10;
                  const centerY = b.rowStart * ROW_H + (b.rowCount * ROW_H) / 2;
                  const left = pct(b.startMin);
                  const width = Math.max(0.8, pct(b.endMin) - pct(b.startMin));
                  return (
                    <div key={b.appointment_id ?? b.hcp_job_id ?? bi}>
                      {/* the lane bar */}
                      <div className="absolute overflow-hidden rounded-lg z-10" title={b.customer ?? ""}
                        style={{ top, height, left: `${left}%`, width: `${width}%`, border: `1px solid ${b.leadColor}66`, backgroundColor: `${b.leadColor}12` }}>
                        {b.hcp_job_id ? (
                          <Link href={`/job/${b.hcp_job_id}`} className="absolute left-1 top-0.5 max-w-[calc(100%-8px)] truncate text-[10px] font-semibold text-neutral-700 hover:underline">{b.customer ?? "—"}</Link>
                        ) : (
                          <span className="absolute left-1 top-0.5 max-w-[calc(100%-8px)] truncate text-[10px] font-semibold text-neutral-700">{b.customer ?? "—"}</span>
                        )}
                      </div>
                      {/* the status center-line, painted across the job's active window */}
                      {b.segs.map((s, si) => (
                        <div key={si} className="absolute rounded-full z-10" title={s.label}
                          style={{
                            left: `${pct(s.startMin)}%`,
                            width: `${Math.max(0.5, pct(s.endMin) - pct(s.startMin))}%`,
                            top: centerY - 3, height: 6,
                            backgroundColor: s.color, opacity: s.planned ? 0.5 : 1,
                            ...(s.planned ? { backgroundImage: "repeating-linear-gradient(90deg,transparent,transparent 3px,rgba(255,255,255,0.65) 3px,rgba(255,255,255,0.65) 6px)" } : {}),
                          }} />
                      ))}
                      {/* current-status dot */}
                      <span className="absolute z-10 rounded-full ring-2 ring-white" title={b.curState}
                        style={{ left: `${pct(b.endMin)}%`, top: centerY, width: 9, height: 9, backgroundColor: b.curColor, transform: "translate(-50%, -50%)" }} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-neutral-500">
        Techs are ordered so crews on the same job sit together — a job is the bar across their rows. Trigger 5 (Present) needs the &quot;Present complete&quot; action to render; coming as a fast-follow.
      </p>
    </PageShell>
  );
}
