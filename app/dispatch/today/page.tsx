// Today timeline (#24 reframed, Madisson 2026-06-01) — a live "Gantt of job-lanes"
// for today. X = 15-min columns across the operating day; Y = one lane per job;
// the crew lives inside the lane; a center-line paints in lifecycle-state colors
// as OMW(2)/Start(3)/Estimate(4)/Present(5)/Finish(6)/Collect(7) fire. Planned
// lanes (scheduled window) render faint as the baseline and solidify as triggers
// fire — so the board is useful before perfect button adoption and surfaces
// plan-vs-actual drift. Additive surface: does not touch the existing /dispatch.

import { db } from "../../../lib/supabase";
import { redirect } from "next/navigation";
import { getCurrentTech } from "../../../lib/current-tech";
import { PageShell } from "../../../components/PageShell";
import { TechAvatar } from "../../../components/TechAvatar";
import { AutoRefresh } from "../../../components/AutoRefresh";
import { resolveTechColor } from "../../../lib/tech-colors";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today timeline · TPAR-DB" };

const CHI = "America/Chicago";
const DAY_START = 6 * 60;   // 6:00am
const DAY_END = 20 * 60;    // 8:00pm
const SPAN = DAY_END - DAY_START;

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

export default async function TodayTimelinePage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/dispatch/today");
  if (!me.isAdmin && !me.isManager) redirect("/me");
  const supa = db();

  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: CHI });
  const startUtc = new Date(`${todayKey}T00:00:00${fmtOff(offsetForYmd(todayKey))}`).toISOString();
  const endUtc = new Date(new Date(startUtc).getTime() + 24 * 3600 * 1000).toISOString();
  const nowIso = new Date().toISOString();
  const nowMin = chiMin(nowIso);

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

  const lanes = appts.map((a) => {
    const members = (a.tech_all_names && a.tech_all_names.length ? a.tech_all_names : (a.tech_primary_name ? [a.tech_primary_name] : []))
      .filter((n): n is string => !!n);
    const primary = a.tech_primary_name ?? null;
    const leadFull = (primary && leadSet.has(primary)) ? primary : members.find((m) => leadSet.has(m)) ?? primary ?? members[0] ?? null;
    const crew = [...new Set([leadFull, ...members].filter((n): n is string => !!n))]
      .map((full) => ({ full, short: shortByFull.get(full) ?? full.split(" ")[0], avatarUrl: avatarByFull.get(full) ?? null, colorHex: colorByFull.get(full) ?? null }));

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
        let e2 = i < evs.length - 1 ? chiMin(evs[i + 1].fired_at) : (terminal ? s + 8 : nowMin);
        if (e2 < s) e2 = s + 8;
        segs.push({ startMin: s, endMin: e2, color: st.color, label: `${st.label} ${chiClock(evs[i].fired_at)}`, planned: false });
      }
    }
    const lastEv = evs[evs.length - 1];
    const curState = lastEv ? (STATE[lastEv.trigger_number]?.label ?? "Scheduled") : "Scheduled";
    const curColor = lastEv ? (STATE[lastEv.trigger_number]?.color ?? PLANNED) : PLANNED;
    return { a, crew, leadColor: leadFull ? resolveTechColor(leadFull, colorByFull) : "#94a3b8", schedStart, segs, curState, curColor };
  });

  const hours: number[] = [];
  for (let h = DAY_START / 60; h <= DAY_END / 60; h++) hours.push(h);
  const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "a" : "p"}`;

  return (
    <PageShell
      kicker="Dispatch"
      title="📊 Today timeline"
      description="Job-lanes paint as OMW → Start → Finish fire. Faint = scheduled (planned); solid = actual. Updates every 60s."
      backHref="/dispatch"
      backLabel="Dispatch"
    >
      <AutoRefresh seconds={60} />

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-600">
        <span className="font-semibold uppercase tracking-wide text-neutral-500">States</span>
        {[2, 3, 4, 5, 6, 7].map((t) => (
          <span key={t} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-4 rounded-sm" style={{ backgroundColor: STATE[t].color }} />
            {STATE[t].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm opacity-40" style={{ backgroundColor: PLANNED }} /> scheduled</span>
        <span className="ml-auto text-neutral-400">{lanes.length} job{lanes.length === 1 ? "" : "s"} today · now {chiClock(nowIso)}</span>
      </div>

      {lanes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          No jobs scheduled today.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <div style={{ minWidth: 920 }}>
            {/* time axis */}
            <div className="flex border-b border-neutral-200 bg-neutral-50/60">
              <div className="w-48 shrink-0 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Job · crew</div>
              <div className="relative flex-1 h-6">
                {hours.map((h) => (
                  <span key={h} className="absolute top-0 -translate-x-1/2 text-[10px] text-neutral-400" style={{ left: `${pct(h * 60)}%` }}>{hourLabel(h)}</span>
                ))}
              </div>
            </div>

            {lanes.map((lane, i) => (
              <div key={lane.a.appointment_id ?? lane.a.hcp_job_id ?? i} className={`flex items-stretch border-b border-neutral-100 ${i % 2 ? "bg-neutral-50/30" : ""}`}>
                <div className="w-48 shrink-0 border-r border-neutral-100 px-2 py-1.5" style={{ borderLeft: `3px solid ${lane.leadColor}` }}>
                  {lane.a.hcp_job_id ? (
                    <Link href={`/job/${lane.a.hcp_job_id}`} className="block truncate text-xs font-semibold text-neutral-900 hover:underline">{lane.a.customer_name ?? "—"}</Link>
                  ) : (
                    <div className="truncate text-xs font-semibold text-neutral-900">{lane.a.customer_name ?? "—"}</div>
                  )}
                  <div className="mt-0.5 flex items-center gap-1">
                    {lane.crew.map((m) => <TechAvatar key={m.full} shortName={m.short} avatarUrl={m.avatarUrl} colorHex={m.colorHex} size={16} />)}
                    <span className="ml-1 text-[10px] text-neutral-400">{chiClock(lane.a.scheduled_start)}</span>
                  </div>
                </div>
                <div className="relative flex-1" style={{ minHeight: 40 }}>
                  {/* hour gridlines */}
                  {hours.map((h) => <div key={h} className="absolute top-0 h-full w-px bg-neutral-100" style={{ left: `${pct(h * 60)}%` }} />)}
                  {/* now line */}
                  {nowMin >= DAY_START && nowMin <= DAY_END ? (
                    <div className="absolute top-0 h-full w-px bg-rose-400/70" style={{ left: `${pct(nowMin)}%` }} title={`now ${chiClock(nowIso)}`} />
                  ) : null}
                  {/* center-line segments */}
                  {lane.segs.map((s, si) => (
                    <div key={si} title={s.label}
                      className="absolute rounded-full"
                      style={{
                        left: `${pct(s.startMin)}%`,
                        width: `${Math.max(0.6, pct(s.endMin) - pct(s.startMin))}%`,
                        top: "calc(50% - 3px)", height: 6,
                        backgroundColor: s.color, opacity: s.planned ? 0.4 : 1,
                        ...(s.planned ? { backgroundImage: "repeating-linear-gradient(90deg,transparent,transparent 3px,rgba(255,255,255,0.6) 3px,rgba(255,255,255,0.6) 6px)" } : {}),
                      }} />
                  ))}
                  {/* current-status dot */}
                  <span className="absolute -translate-y-1/2 rounded-full ring-2 ring-white" title={lane.curState}
                    style={{ left: `${pct(lane.segs.length ? lane.segs[lane.segs.length - 1].endMin : lane.schedStart)}%`, top: "50%", width: 9, height: 9, backgroundColor: lane.curColor, transform: "translate(-50%, -50%)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-neutral-500">
        Lanes seed from the schedule (faint) and paint solid as lifecycle triggers fire. Trigger 5 (Present) needs the &quot;Present complete&quot; action to render — coming as a fast-follow.
      </p>
    </PageShell>
  );
}
