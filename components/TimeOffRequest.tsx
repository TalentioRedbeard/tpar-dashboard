"use client";

// "Request time off" affordance for the schedule (all roles, Danny 2026-07-17).
// Opens a small form (from/to + reason) -> requestTimeOff -> the office's /manage
// queue. On approval the day shows an "Off — Name" band on the board.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestTimeOff } from "../lib/time-off-actions";

export function TimeOffRequest({ todayKey }: { todayKey: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(todayKey);
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, startT] = useTransition();

  const submit = () => {
    setMsg(null);
    startT(async () => {
      const res = await requestTimeOff({ start_date: start, end_date: end || start, reason });
      if (!res.ok) { setMsg({ text: res.error ?? "failed", error: true }); return; }
      setMsg({ text: "Requested — sent to the office ✓" });
      setReason(""); setEnd("");
      router.refresh();
      setTimeout(() => { setOpen(false); setMsg(null); }, 1600);
    });
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
      >
        🏖️ Request time off
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-3 text-xs shadow-lg">
            <div className="mb-2 font-semibold text-neutral-800">Request time off</div>
            <label className="mb-2 block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">From</span>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1" />
            </label>
            <label className="mb-2 block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">To — optional (same day if blank)</span>
              <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1" />
            </label>
            <label className="mb-2 block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Reason — optional</span>
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. doctor, family" className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1" />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={submit}
              className="w-full rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send request"}
            </button>
            {msg ? <div className={`mt-2 text-[11px] ${msg.error ? "text-red-700" : "text-emerald-700"}`}>{msg.text}</div> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
