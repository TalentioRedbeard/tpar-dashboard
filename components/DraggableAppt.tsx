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
  /** px from the block's top where the user grabbed it — so a block grabbed in its
   *  middle lands its TOP at the cursor, not jumping up. Set on dragstart. */
  grabOffsetY?: number;
};

// Same-document drag state. dataTransfer.getData() is blocked during `dragover`
// (payload only readable on `drop`), so the live time-chip in CalendarDayDrop
// reads the grab offset from here while hovering. Set on dragstart.
export const dragState: { grabOffsetY: number } = { grabOffsetY: 0 };

export function DraggableAppt({ payload, multiVisit, children }: { payload: ApptPayload; multiVisit?: boolean; children: ReactNode }) {
  if (!payload.apptId) return <>{children}</>;
  // Multi-visit jobs: update-hcp-job moves the whole JOB, so a per-visit drag
  // would move every visit. Disabled with the why (v1; per-visit moves are
  // future work — applyJobMove also refuses server-side).
  if (multiVisit) {
    return (
      <div className="cursor-not-allowed" title="Multi-visit job — move it in HCP for now (per-visit moves coming)">
        {children}
      </div>
    );
  }
  return (
    <div
      draggable
      onDragStart={(e) => {
        // Where within the block the drag began — reliably from the block's own
        // rect (offsetY is unreliable when the target is a nested child).
        const rect = e.currentTarget.getBoundingClientRect();
        const grabOffsetY = Math.max(0, e.clientY - rect.top);
        dragState.grabOffsetY = grabOffsetY;
        e.dataTransfer.setData(APPT_MIME, JSON.stringify({ ...payload, grabOffsetY }));
        e.dataTransfer.effectAllowed = "move";
      }}
      className="cursor-grab active:cursor-grabbing"
      title="Drag to a different tech/day/time — moves it in HCP immediately (Undo available)"
    >
      {children}
    </div>
  );
}
