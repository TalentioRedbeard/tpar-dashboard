"use client";

// Drop target for one DAY column of the HCP-style calendar week grid (Danny
// 2026-07-20 overhaul). Dropping an appointment into a different day column moves
// it to that day, keeping its tech and time-of-day (v1: day-level, reuses the
// proven move actions; time-precise drag is a fast-follow). Office = immediate HCP
// write (applyJobMove); tech = office-approval request (proposeJobMove). Inert on
// past days.

import { useEffect, useRef, useState, useTransition, type ReactNode, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { applyJobMove, proposeJobMove } from "../lib/schedule-changes";
import { APPT_MIME } from "./DraggableAppt";

export function CalendarDayDrop({ dateKey, mode = "apply", disabled, className, style, children }: {
  dateKey: string;
  mode?: "apply" | "request";
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [result, setResult] = useState<{ label: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const show = (r: { label: string; error?: boolean }, ms = 8000) => {
    setResult(r);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult(null), ms);
  };

  return (
    <div
      className={`${className ?? ""} ${over && !disabled ? "bg-brand-50/50 ring-1 ring-inset ring-brand-300" : ""} ${pending ? "opacity-60" : ""}`}
      style={style}
      onDragOver={(e) => { if (!disabled && e.dataTransfer.types.includes(APPT_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (disabled) return;
        const raw = e.dataTransfer.getData(APPT_MIME);
        if (!raw) return;
        e.preventDefault();
        let p: { apptId: string; hcpJobId: string | null; customerName: string | null; currentStart: string; currentTech: string; currentDate: string };
        try { p = JSON.parse(raw); } catch { return; }
        if (p.currentDate === dateKey) return; // dropped on the same day
        start(async () => {
          const args = {
            appointment_id: p.apptId, hcp_job_id: p.hcpJobId, customer_name: p.customerName,
            current_start: p.currentStart, current_tech: p.currentTech, current_date: p.currentDate,
            new_tech: p.currentTech, new_date: dateKey, // same tech, new day
          };
          const res = mode === "request" ? await proposeJobMove(args) : await applyJobMove(args);
          if (!res.ok) { show({ label: res.error ?? "Move failed", error: true }); return; }
          show({ label: mode === "request" ? `Requested${p.customerName ? ` ${p.customerName}` : ""} → office ✓` : `Moved${p.customerName ? ` ${p.customerName}` : ""} ✓ — sent to HCP` });
          router.refresh();
        });
      }}
    >
      {children}
      {result ? (
        <div className={`pointer-events-none absolute bottom-1 left-1 right-1 z-40 truncate rounded-lg border px-2 py-1 text-[10px] shadow-sm ${result.error ? "border-red-300 bg-red-50 text-red-800" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {result.label}
        </div>
      ) : null}
    </div>
  );
}
