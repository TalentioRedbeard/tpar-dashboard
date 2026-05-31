"use client";

// Drop target for a schedule (tech, day) cell (#21). When an appt is dropped from
// a different cell, queues a reschedule/reassign proposal via proposeJobMove.
// Inert for past days + the Unassigned row.

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { proposeJobMove } from "../lib/schedule-changes";
import { APPT_MIME } from "./DraggableAppt";

export function DropCell({ techFull, dateKey, disabled, className, children }: {
  techFull: string; dateKey: string; disabled?: boolean; className?: string; children: ReactNode;
}) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [pending, start] = useTransition();

  if (disabled || techFull === "Unassigned") return <div className={className}>{children}</div>;

  return (
    <div
      className={`${className ?? ""} transition ${over ? "ring-2 ring-brand-400 ring-inset bg-brand-50/40" : ""} ${pending ? "opacity-60" : ""}`}
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
          await proposeJobMove({
            appointment_id: p.apptId, hcp_job_id: p.hcpJobId, customer_name: p.customerName,
            current_start: p.currentStart, current_tech: p.currentTech, current_date: p.currentDate,
            new_tech: techFull, new_date: dateKey,
          });
          router.refresh();
        });
      }}
    >
      {children}
    </div>
  );
}
