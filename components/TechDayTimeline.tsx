// #24 Day timeline — the /schedule "Day" tab rendered as a live, lane-based
// re-description of the day. Y = tech rows (dispatcher-curated order), X = time of
// day (6a–8p). Each row stacks three layers:
//   • clock rail (top)      — on-the-clock span(s) from tech_time_entries
//   • job bands (middle)    — appointments, painted by the 7 lifecycle triggers
//                             (faint = planned, solid = actual), with a live clock
//                             + running cost chip per job
//   • movement strip (bot)  — GPS transit + classified stops (parts/lunch/gas/home/
//                             shop) from tech_day_segments_v
// Server component: recomputed each load; the page wraps it in <AutoRefresh 60s>
// on today so the paint + live clocks advance. Lifecycle job time takes visual
// precedence over GPS stops (a dwell at a customer site IS on-job time).

import Link from "next/link";
import { TechAvatar } from "./TechAvatar";

export const DAY_START = 6 * 60;   // 6:00a
export const DAY_END = 20 * 60;    // 8:00p
const SPAN = DAY_END - DAY_START;
const ROW_H = 58;

export type TLActivity = { startMin: number; endMin: number; kind: string; label: string };
export type TLLifeSeg = { startMin: number; endMin: number; color: string; label: string; planned: boolean };
export type TLJob = {
  key: string;
  hcpJobId: string | null;
  customer: string | null;
  startMin: number;
  endMin: number;
  segs: TLLifeSeg[];
  curColor: string;
  curState: string;
  leadColor: string;
  liveMinutes: number | null;
  materials: number | null;
  laborEst: number | null;
};
export type TLRow = {
  full: string;
  short: string;
  avatarUrl: string | null;
  colorHex: string | null;
  isLead: boolean;
  unassigned?: boolean;
  apptCount: number;
  dollars: number;
  clockSpans: { startMin: number; endMin: number; open: boolean }[];
  activity: TLActivity[];
  jobs: TLJob[];
};

// GPS movement-strip styling per kind (color + optional diagonal hatch).
const ACT: Record<string, { bg: string; hatch?: boolean }> = {
  in_transit: { bg: "#60a5fa", hatch: true },
  parts_run: { bg: "#f59e0b", hatch: true },
  lunch: { bg: "#9ca3af", hatch: true },
  gas: { bg: "#fb923c" },
  drove_home: { bg: "#6366f1" },
  back_to_shop: { bg: "#475569" },
  stop_other: { bg: "#94a3b8" },
  stop_unknown: { bg: "#d1d5db" },
};
const hatchStyle = { backgroundImage: "repeating-linear-gradient(45deg,rgba(255,255,255,.55) 0 2px,transparent 2px 5px)" };

const pct = (min: number) => Math.max(0, Math.min(100, ((min - DAY_START) / SPAN) * 100));
const widthPct = (a: number, b: number) => Math.max(0.4, pct(b) - pct(a));
const clockLabel = (min: number) => { const h = Math.floor(min / 60), m = min % 60; const hh = ((h + 11) % 12) + 1; return `${hh}:${String(m).padStart(2, "0")}${h < 12 ? "a" : "p"}`; };
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function TechDayTimeline({ rows, isToday, nowMin }: { rows: TLRow[]; isToday: boolean; nowMin: number | null }) {
  const hours: number[] = [];
  for (let h = DAY_START / 60; h <= DAY_END / 60; h++) hours.push(h);
  const quarters: number[] = [];
  for (let m = DAY_START; m <= DAY_END; m += 15) quarters.push(m);
  const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "a" : "p"}`;
  const showNow = isToday && nowMin != null && nowMin >= DAY_START && nowMin <= DAY_END;

  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
      <div style={{ minWidth: 1000 }}>
        {/* legend */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-100 px-3 py-1.5 text-[10px] text-neutral-500">
          <Chip c="#cbd5e1">planned</Chip><Chip c="#2563eb">OMW</Chip><Chip c="#f59e0b">start</Chip>
          <Chip c="#8b5cf6">estimate</Chip><Chip c="#a855f7">present</Chip><Chip c="#16a34a">work/finish</Chip><Chip c="#15803d">collect</Chip>
          <span className="mx-1 text-neutral-300">·</span>
          <Chip c="#60a5fa" hatch>transit</Chip><Chip c="#f59e0b" hatch>parts</Chip><Chip c="#9ca3af" hatch>lunch</Chip><Chip c="#fb923c">gas</Chip><Chip c="#6366f1">home</Chip><Chip c="#475569">shop</Chip>
        </div>

        {/* time axis */}
        <div className="flex border-b border-neutral-200 bg-neutral-50/60">
          <div className="w-44 shrink-0 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Technician</div>
          <div className="relative h-5 flex-1">
            {hours.map((h) => (
              <span key={h} className="absolute top-0 -translate-x-1/2 text-[10px] text-neutral-400" style={{ left: `${pct(h * 60)}%` }}>{hourLabel(h)}</span>
            ))}
          </div>
        </div>

        {/* body */}
        <div className="flex">
          {/* gutter */}
          <div className="w-44 shrink-0">
            {rows.map((r) => (
              <div key={r.full} className="flex items-center gap-1.5 border-b border-neutral-100 px-2" style={{ height: ROW_H }}>
                {!r.unassigned ? <TechAvatar shortName={r.short} avatarUrl={r.avatarUrl} colorHex={r.colorHex} size={20} /> : null}
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-xs font-semibold text-neutral-900">{r.short}</span>
                    {r.isLead ? <span className="text-[9px] text-amber-500" title="Lead">★</span> : null}
                  </div>
                  <div className="text-[10px] text-neutral-400">{r.apptCount} job{r.apptCount === 1 ? "" : "s"}{r.dollars > 0 ? ` · ${money(r.dollars)}` : ""}</div>
                </div>
              </div>
            ))}
          </div>

          {/* canvas */}
          <div className="relative flex-1" style={{ height: rows.length * ROW_H }}>
            {rows.map((r, i) => (
              <div key={r.full} className={`absolute inset-x-0 border-b border-neutral-100 ${i % 2 ? "bg-neutral-50/40" : ""}`} style={{ top: i * ROW_H, height: ROW_H }} />
            ))}
            {quarters.map((m) => (
              <div key={m} className="absolute top-0 bottom-0 w-px" style={{ left: `${pct(m)}%`, backgroundColor: m % 60 === 0 ? "#e2e8f0" : "#f4f6f8" }} />
            ))}
            {showNow ? <div className="absolute top-0 bottom-0 z-30 w-px bg-rose-400/80" style={{ left: `${pct(nowMin!)}%` }} title={`now ${clockLabel(nowMin!)}`} /> : null}

            {rows.map((r, i) => {
              const top = i * ROW_H;
              return (
                <div key={`lyr-${r.full}`}>
                  {/* clock rail (top) */}
                  {r.clockSpans.map((c, ci) => (
                    <div key={`clk-${ci}`} className="absolute z-10 rounded-full bg-neutral-300" title={`On the clock ${clockLabel(c.startMin)}–${c.open ? "now" : clockLabel(c.endMin)}`}
                      style={{ top: top + 5, height: 4, left: `${pct(c.startMin)}%`, width: `${widthPct(c.startMin, c.endMin)}%` }} />
                  ))}
                  {/* GPS movement strip (bottom) */}
                  {r.activity.map((a, ai) => {
                    const st = ACT[a.kind] ?? ACT.stop_unknown;
                    return (
                      <div key={`act-${ai}`} className="absolute z-10 rounded-sm" title={`${a.label} ${clockLabel(a.startMin)}–${clockLabel(a.endMin)}`}
                        style={{ top: top + ROW_H - 11, height: 5, left: `${pct(a.startMin)}%`, width: `${widthPct(a.startMin, a.endMin)}%`, backgroundColor: st.bg, opacity: a.kind === "stop_unknown" ? 0.5 : 0.92, ...(st.hatch ? hatchStyle : {}) }} />
                    );
                  })}
                  {/* job bands (middle) */}
                  {r.jobs.map((j) => {
                    const bandTop = top + 13, bandH = ROW_H - 30;
                    const centerY = bandTop + bandH / 2;
                    const inner = (
                      <>
                        <div className="absolute z-10 overflow-hidden rounded-md" title={j.customer ?? ""}
                          style={{ top: bandTop, height: bandH, left: `${pct(j.startMin)}%`, width: `${widthPct(j.startMin, j.endMin)}%`, border: `1px solid ${j.leadColor}66`, backgroundColor: `${j.leadColor}12` }}>
                          <span className="absolute left-1 top-0 truncate text-[10px] font-semibold text-neutral-700" style={{ maxWidth: "calc(100% - 6px)" }}>{j.customer ?? "—"}</span>
                          <span className="absolute bottom-0 left-1 truncate text-[9px] text-neutral-500" style={{ maxWidth: "calc(100% - 6px)" }}>
                            {j.liveMinutes != null ? `⏱ ${Math.floor(j.liveMinutes / 60)}h${String(j.liveMinutes % 60).padStart(2, "0")}` : ""}
                            {j.materials != null && j.materials > 0 ? ` · ${money(j.materials)} mat` : ""}
                            {j.laborEst != null && j.laborEst > 0 ? ` +${money(j.laborEst)} lbr` : ""}
                          </span>
                        </div>
                        {j.segs.map((s, si) => (
                          <div key={si} className="absolute z-20 rounded-full" title={s.label}
                            style={{ top: centerY - 2, height: 4, left: `${pct(s.startMin)}%`, width: `${widthPct(s.startMin, s.endMin)}%`, backgroundColor: s.color, opacity: s.planned ? 0.5 : 1, ...(s.planned ? hatchStyle : {}) }} />
                        ))}
                      </>
                    );
                    return j.hcpJobId ? (
                      <Link key={j.key} href={`/job/${j.hcpJobId}`} className="block">{inner}</Link>
                    ) : <div key={j.key}>{inner}</div>;
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ c, hatch, children }: { c: string; hatch?: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ backgroundColor: c, ...(hatch ? hatchStyle : {}) }} />
      {children}
    </span>
  );
}
