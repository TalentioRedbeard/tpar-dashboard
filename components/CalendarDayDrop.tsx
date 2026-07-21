"use client";

// Drop target for one DAY column of the HCP-style calendar week grid (Danny
// 2026-07-20 overhaul; time-precise 2026-07-21). The column IS the time grid:
// its top edge is DAY_START and every 60 min is HOUR_H px, so the cursor Y maps
// back to a clock time. Dropping computes the target start from where the block's
// TOP lands (cursor minus the grab offset), snapped to 15 min — drag 1:00 → the
// 2:30 line and it reschedules to 2:30, no typing. Duration is preserved by the
// move action. Cross-day drops carry the time too. Office = immediate HCP write
// (applyJobMove); tech = office-approval request (proposeJobMove). Inert on past
// days.

import { useEffect, useRef, useState, useTransition, type ReactNode, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { applyJobMove, proposeJobMove } from "../lib/schedule-changes";
import { APPT_MIME, dragState } from "./DraggableAppt";

const SNAP_MIN = 15;

function chicagoHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false }).slice(0, 5);
}
function label12(min: number): string {
  const hh = Math.floor(min / 60), mm = min % 60;
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

export function CalendarDayDrop({
  dateKey, mode = "apply", disabled, className, style, children,
  dayStartMin = 6 * 60, dayEndMin = 20 * 60, hourHeight = 46,
}: {
  dateKey: string;
  mode?: "apply" | "request";
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  dayStartMin?: number;
  dayEndMin?: number;
  hourHeight?: number;
}) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [hover, setHover] = useState<{ topPx: number; label: string } | null>(null);
  const [result, setResult] = useState<{ label: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const show = (r: { label: string; error?: boolean }, ms = 8000) => {
    setResult(r);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult(null), ms);
  };

  // Snapped target minute for a block whose TOP is at (clientY - grabOffsetY),
  // measured within this column (whose top edge = dayStartMin).
  const targetMin = (clientY: number, rectTop: number, grabOffsetY: number): number => {
    const blockTopY = clientY - rectTop - grabOffsetY;
    let min = dayStartMin + (blockTopY / hourHeight) * 60;
    min = Math.round(min / SNAP_MIN) * SNAP_MIN;
    return Math.max(dayStartMin, Math.min(dayEndMin, min));
  };

  return (
    <div
      className={`${className ?? ""} ${over && !disabled ? "bg-brand-50/40" : ""} ${pending ? "opacity-60" : ""}`}
      style={style}
      onDragOver={(e) => {
        if (disabled || !e.dataTransfer.types.includes(APPT_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
        const rect = e.currentTarget.getBoundingClientRect();
        const min = targetMin(e.clientY, rect.top, dragState.grabOffsetY);
        setHover({ topPx: ((min - dayStartMin) / 60) * hourHeight, label: label12(min) });
      }}
      onDragLeave={() => { setOver(false); setHover(null); }}
      onDrop={(e) => {
        setOver(false);
        setHover(null);
        if (disabled) return;
        const raw = e.dataTransfer.getData(APPT_MIME);
        if (!raw) return;
        e.preventDefault();
        let p: { apptId: string; hcpJobId: string | null; customerName: string | null; currentStart: string; currentTech: string; currentDate: string; grabOffsetY?: number };
        try { p = JSON.parse(raw); } catch { return; }
        const rect = e.currentTarget.getBoundingClientRect();
        const min = targetMin(e.clientY, rect.top, p.grabOffsetY ?? 0);
        const hh = Math.floor(min / 60), mm = min % 60;
        const newTime = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        // Truly dropped in place — same day AND same snapped time → no-op quietly.
        if (p.currentDate === dateKey && newTime === chicagoHHMM(p.currentStart)) return;
        start(async () => {
          const args = {
            appointment_id: p.apptId, hcp_job_id: p.hcpJobId, customer_name: p.customerName,
            current_start: p.currentStart, current_tech: p.currentTech, current_date: p.currentDate,
            new_tech: p.currentTech, new_date: dateKey, new_time: newTime,
          };
          const res = mode === "request" ? await proposeJobMove(args) : await applyJobMove(args);
          if (!res.ok) { show({ label: res.error ?? "Move failed", error: true }); return; }
          const who = p.customerName ? ` ${p.customerName}` : "";
          show({ label: mode === "request" ? `Requested${who} → ${label12(min)} → office ✓` : `Moved${who} → ${label12(min)} ✓ — sent to HCP` });
          router.refresh();
        });
      }}
    >
      {children}
      {hover && !disabled ? (
        <div className="pointer-events-none absolute inset-x-0 z-30" style={{ top: hover.topPx }}>
          <div className="h-0.5 bg-brand-500" />
          <div className="absolute -top-2 left-1 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">→ {hover.label}</div>
        </div>
      ) : null}
      {result ? (
        <div className={`pointer-events-none absolute bottom-1 left-1 right-1 z-40 truncate rounded-lg border px-2 py-1 text-[10px] shadow-sm ${result.error ? "border-red-300 bg-red-50 text-red-800" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {result.label}
        </div>
      ) : null}
    </div>
  );
}
