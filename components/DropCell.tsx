"use client";

// Drop target for a schedule (tech, day) cell (#21 → immediate since
// 2026-07-16, dispatch×schedule merge segment 1): dropping an appt from a
// different cell writes the move to HCP IMMEDIATELY (applyJobMove — HCP's own
// drag feel, Madisson's trust unlock), with a 10s Undo chip that re-applies
// the prior slot. notify_customer is always false on drag moves. Inert for
// past days + the Unassigned row.

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { applyJobMove, proposeJobMove } from "../lib/schedule-changes";
import { APPT_MIME } from "./DraggableAppt";

type MoveResult = {
  label: string;                 // "Moved Matt Crow ✓"
  undo: (() => Promise<void>) | null;
  error?: boolean;
};

export function DropCell({ techFull, dateKey, disabled, className, mode = "apply", children }: {
  techFull: string; dateKey: string; disabled?: boolean; className?: string;
  // "apply" (office) = write the move to HCP immediately; "request" (tech) =
  // queue an office-approval request (proposeJobMove), never touch HCP.
  mode?: "apply" | "request"; children: ReactNode;
}) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [result, setResult] = useState<MoveResult | null>(null);
  const [pending, start] = useTransition();
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current); }, []);

  if (disabled || techFull === "Unassigned") return <div className={className}>{children}</div>;

  const showResult = (r: MoveResult, ms = 10_000) => {
    setResult(r);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setResult(null), ms);
  };

  return (
    <div
      className={`relative ${className ?? ""} transition ${over ? "ring-2 ring-brand-400 ring-inset bg-brand-50/40" : ""} ${pending ? "opacity-60" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(APPT_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const raw = e.dataTransfer.getData(APPT_MIME);
        if (!raw) return;
        e.preventDefault();
        let p: { apptId: string; hcpJobId: string | null; customerName: string | null; currentStart: string; currentTech: string; currentDate: string };
        try { p = JSON.parse(raw); } catch { return; }
        if (p.currentTech === techFull && p.currentDate === dateKey) return; // same cell
        start(async () => {
          if (mode === "request") {
            // Tech board: queue a request for the office, no HCP write.
            const rq = await proposeJobMove({
              appointment_id: p.apptId, hcp_job_id: p.hcpJobId, customer_name: p.customerName,
              current_start: p.currentStart, current_tech: p.currentTech, current_date: p.currentDate,
              new_tech: techFull, new_date: dateKey,
            });
            if (!rq.ok) { showResult({ label: rq.error ?? "Request failed", undo: null, error: true }, 8_000); return; }
            showResult({ label: `Requested${p.customerName ? ` ${p.customerName}` : ""} → sent to office ✓`, undo: null }, 8_000);
            router.refresh();
            return;
          }
          const res = await applyJobMove({
            appointment_id: p.apptId, hcp_job_id: p.hcpJobId, customer_name: p.customerName,
            current_start: p.currentStart, current_tech: p.currentTech, current_date: p.currentDate,
            new_tech: techFull, new_date: dateKey,
          });
          if (!res.ok) {
            showResult({ label: res.error ?? "Move failed", undo: null, error: true }, 8_000);
            return;
          }
          showResult({
            label: `Moved${p.customerName ? ` ${p.customerName}` : ""} ✓ — sent to HCP`,
            undo: async () => {
              // Reverse: same appointment, slots swapped; time-of-day rides
              // current_start in both directions.
              await applyJobMove({
                appointment_id: p.apptId, hcp_job_id: p.hcpJobId, customer_name: p.customerName,
                current_start: p.currentStart, current_tech: techFull, current_date: dateKey,
                new_tech: p.currentTech, new_date: p.currentDate,
              });
              router.refresh();
            },
          });
          router.refresh();
        });
      }}
    >
      {children}
      {result ? (
        <div className={`absolute bottom-1 left-1 right-1 z-20 flex items-center justify-between gap-2 rounded-lg border px-2 py-1 text-[11px] shadow-sm ${result.error ? "border-red-300 bg-red-50 text-red-800" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          <span className="min-w-0 truncate">{result.label}</span>
          {result.undo ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => { const u = result.undo; setResult(null); if (u) start(async () => { await u(); }); }}
              className="shrink-0 rounded bg-white px-1.5 py-0.5 font-semibold text-brand-700 ring-1 ring-brand-300 hover:bg-brand-50 disabled:opacity-50"
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
