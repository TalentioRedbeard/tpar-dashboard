"use client";

// Reschedule ruler (#21). A "⏰" on each appointment opens a horizontal time-ruler
// (8am–5pm highlighted green) — click to pick a new start time, or type it. On
// confirm it queues a proposed change (TPAR-side; the HCP move lands when the
// write path is enabled).

import { useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { requestReschedule } from "../lib/schedule-changes";

const START_MIN = 8 * 60;   // 8:00
const END_MIN = 17 * 60;    // 5:00pm
const SPAN = END_MIN - START_MIN;

function toMin(t: string) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function fmt12(t: string) { const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; const hh = h % 12 || 12; return `${hh}:${String(m).padStart(2, "0")}${ap}`; }

export function RescheduleButton({ appointmentId, hcpJobId, customerName, currentStart, dateKey }: {
  appointmentId: string; hcpJobId: string | null; customerName: string | null; currentStart: string; dateKey: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [time, setTime] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function pickFromRuler(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    let mins = START_MIN + Math.round((frac * SPAN) / 15) * 15; // snap 15 min
    mins = Math.max(START_MIN, Math.min(END_MIN, mins));
    setTime(`${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`);
  }

  const selFrac = time ? (toMin(time) - START_MIN) / SPAN : null;

  function submit() {
    if (!time) { setErr("Pick a time first."); return; }
    setErr(null);
    start(async () => {
      const r = await requestReschedule({ appointment_id: appointmentId, hcp_job_id: hcpJobId, customer_name: customerName, current_start: currentStart, proposed_date: dateKey, proposed_time: time });
      if (r.ok) { setOpen(false); router.refresh(); } else setErr(r.error ?? "failed");
    });
  }

  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)} title="Reschedule" className="rounded border border-neutral-300 bg-white px-1 py-0.5 text-[9px] text-neutral-600 hover:border-brand-400 hover:bg-brand-50">⏰ reschedule</button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-3 text-xs shadow-xl">
            <div className="mb-0.5 font-semibold text-neutral-800">Reschedule {customerName ?? ""}</div>
            <div className="mb-2 text-[10px] text-neutral-500">New start time (same day) — click the ruler or type.</div>
            <div onClick={pickFromRuler} className="relative mb-2 h-9 cursor-crosshair rounded bg-emerald-100 ring-1 ring-emerald-200" title="8am–5pm business hours">
              {Array.from({ length: 10 }, (_, i) => 8 + i).map((h) => (
                <div key={h} className="absolute top-0 h-full border-l border-emerald-300/70" style={{ left: `${((h * 60 - START_MIN) / SPAN) * 100}%` }}>
                  <span className="absolute top-0.5 left-0.5 text-[8px] font-medium text-emerald-700">{h > 12 ? h - 12 : h}{h >= 12 ? "p" : "a"}</span>
                </div>
              ))}
              {selFrac != null ? <div className="absolute top-0 z-10 h-full w-0.5 bg-brand-700" style={{ left: `${selFrac * 100}%` }} /> : null}
            </div>
            <div className="mb-2 flex items-center gap-2">
              <input type="time" value={time} min="08:00" max="17:00" step="900" onChange={(e) => setTime(e.target.value)} className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs" />
              <span className="font-medium text-neutral-700">{time ? fmt12(time) : "—"}</span>
            </div>
            {err ? <div className="mb-1 text-[10px] text-red-600">{err}</div> : null}
            <div className="flex items-center gap-2">
              <button type="button" onClick={submit} disabled={pending || !time} className="rounded bg-brand-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-brand-800 disabled:opacity-50">{pending ? "…" : "Queue reschedule"}</button>
              <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-neutral-500 hover:underline">Cancel</button>
            </div>
            <div className="mt-1.5 text-[9px] text-neutral-400">Queues a proposal for review — the move to HCP lands when the write path is enabled.</div>
          </div>
        </>
      ) : null}
    </span>
  );
}
