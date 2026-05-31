"use client";

// Drag source for a schedule appointment (#21). Wraps the appt block; on drag it
// carries the appt id + its current tech/day so a DropCell can propose a move.
// Appts without an appointment_id aren't draggable.

import { type ReactNode } from "react";

export const APPT_MIME = "application/x-tpar-appt";

export type ApptPayload = {
  apptId: string | null;
  hcpJobId: string | null;
  customerName: string | null;
  currentStart: string;
  currentTech: string;
  currentDate: string;
};

export function DraggableAppt({ payload, children }: { payload: ApptPayload; children: ReactNode }) {
  if (!payload.apptId) return <>{children}</>;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(APPT_MIME, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "move";
      }}
      className="cursor-grab active:cursor-grabbing"
      title="Drag to a different tech/day to propose a move"
    >
      {children}
    </div>
  );
}
