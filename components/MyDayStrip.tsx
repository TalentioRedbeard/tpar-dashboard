// "Your day at a glance" — a compact single-row schedule strip for /me (Danny
// 2026-07-17). The tech's own appointments laid out on a 6a–8p time axis, each
// block tappable into the job / estimate. Lighter + phone-friendly than the full
// /schedule day timeline; sits above the actionable appointment cards.

import Link from "next/link";

const DAY_START = 6 * 60;   // 6a
const DAY_END = 20 * 60;    // 8p
const SPAN = DAY_END - DAY_START;
const CHI = "America/Chicago";

export type StripAppt = {
  appointment_id: string | null;
  hcp_job_id: string | null;
  appointment_type: string | null;
  scheduled_start: string;
  scheduled_end: string | null;
  customer_name: string | null;
  status: string | null;
};

const minOfDay = (iso: string) => {
  const s = new Date(iso).toLocaleTimeString("en-GB", { timeZone: CHI, hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: CHI, hour: "numeric", minute: "2-digit" });
const pct = (min: number) => Math.max(0, Math.min(100, ((min - DAY_START) / SPAN) * 100));

function tone(status: string | null): string {
  switch ((status ?? "").toLowerCase()) {
    case "complete": case "complete rated": case "complete unrated":
      return "bg-emerald-100 border-emerald-300 text-emerald-900";
    case "in progress": case "en route":
      return "bg-blue-100 border-blue-300 text-blue-900";
    case "canceled": case "cancelled": case "pro canceled": case "user canceled":
      return "bg-red-50 border-red-200 text-red-700 line-through opacity-70";
    default:
      return "bg-neutral-100 border-neutral-300 text-neutral-800";
  }
}

export function MyDayStrip({ appts, nowMin }: { appts: StripAppt[]; nowMin: number | null }) {
  if (appts.length === 0) return null;
  const hours: number[] = [];
  for (let h = DAY_START / 60; h <= DAY_END / 60; h += 2) hours.push(h);
  const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "a" : "p"}`;
  const showNow = nowMin != null && nowMin >= DAY_START && nowMin <= DAY_END;

  return (
    <div className="mb-4 overflow-x-auto rounded-2xl border border-neutral-200 bg-white p-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">🗓️ Your day at a glance</div>
      <div style={{ minWidth: 560 }}>
        {/* time axis */}
        <div className="relative h-4">
          {hours.map((h) => (
            <span key={h} className="absolute -translate-x-1/2 text-[10px] text-neutral-400" style={{ left: `${pct(h * 60)}%` }}>{hourLabel(h)}</span>
          ))}
        </div>
        {/* track */}
        <div className="relative mt-1 h-11 rounded-md bg-neutral-50">
          {hours.map((h) => <div key={h} className="absolute top-0 bottom-0 w-px bg-neutral-200/70" style={{ left: `${pct(h * 60)}%` }} />)}
          {showNow ? <div className="absolute top-0 bottom-0 z-20 w-px bg-rose-400" style={{ left: `${pct(nowMin!)}%` }} title="now" /> : null}
          {appts.map((a) => {
            const s = minOfDay(a.scheduled_start);
            const e = a.scheduled_end ? minOfDay(a.scheduled_end) : s + 60;
            const left = pct(s);
            const width = Math.max(7, pct(Math.max(e, s + 30)) - left);
            const href = a.hcp_job_id
              ? `/job/${a.hcp_job_id}`
              : a.appointment_type === "estimate" && a.appointment_id
                ? `/estimate/new?appointment=${a.appointment_id}`
                : null;
            const cls = `absolute top-1 bottom-1 z-10 overflow-hidden rounded border px-1 text-[10px] leading-tight ${tone(a.status)} ${href ? "hover:brightness-95" : ""}`;
            const style = { left: `${left}%`, width: `${width}%` };
            const title = `${clock(a.scheduled_start)} · ${a.customer_name ?? ""}${a.status ? ` · ${a.status}` : ""}`;
            const inner = (
              <>
                <div className="truncate font-semibold">{clock(a.scheduled_start)}</div>
                <div className="truncate">{a.customer_name ?? "—"}</div>
              </>
            );
            const key = a.appointment_id ?? `${a.scheduled_start}-${a.customer_name ?? ""}`;
            return href
              ? <Link key={key} href={href} className={cls} style={style} title={title}>{inner}</Link>
              : <div key={key} className={cls} style={style} title={title}>{inner}</div>;
          })}
        </div>
      </div>
    </div>
  );
}
