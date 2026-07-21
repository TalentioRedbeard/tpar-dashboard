"use client";

// Studio — the technician recording hub (Studio Seg 1, Danny 2026-07-21). A
// creator-scoped view of a tech's OWN captures, split into the two-state model:
//   Inbox = unfiled captures (clear after 3 days unless filed)
//   Filed = attached to a job/customer/estimate (permanent)
// Reuses the proven CaptureRow (play / attach / build-estimate) + the GlobalRecorder
// pipeline for an in-hub Record button. Never sees other techs' captures — the
// server action scopes on created_by_uid.

import { GlobalRecorder } from "./GlobalRecorder";
import { CaptureRow } from "./MyCapturesCard";
import type { MyCapture } from "../lib/capture-types";

export function TechStudio({
  inbox, filed, isOwner = false, clockedInJobId = null,
}: {
  inbox: MyCapture[];
  filed: MyCapture[];
  isOwner?: boolean;
  clockedInJobId?: string | null;
}) {
  return (
    <div className="space-y-8">
      {/* In-hub record entry point — same pipeline as the floating recorder. */}
      <div className="rounded-2xl border border-red-200 bg-red-50/40 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-neutral-900">Record a new capture</span>
          <span className="text-xs text-neutral-500">— it lands in your Inbox below until you file it.</span>
        </div>
        <GlobalRecorder isOwner={isOwner} clockedInJobId={clockedInJobId} />
      </div>

      {/* Inbox — unfiled, 3-day clock. */}
      <section>
        <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
          <h2 className="text-base font-semibold text-neutral-800">📥 Inbox</h2>
          <span className="text-xs text-neutral-500">{inbox.length} unfiled · audio clears after 3 days unless you file it (the transcript stays)</span>
        </div>
        {inbox.length ? (
          <ul className="space-y-2">{inbox.map((c) => <CaptureRow key={c.id} c={c} inbox />)}</ul>
        ) : (
          <p className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">Nothing unfiled right now. A recording you don’t file lands here.</p>
        )}
      </section>

      {/* Filed — permanent, attached to work. */}
      <section>
        <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
          <h2 className="text-base font-semibold text-neutral-800">🗂 Filed</h2>
          <span className="text-xs text-neutral-500">{filed.length} kept — attached to a job, customer, or estimate</span>
        </div>
        {filed.length ? (
          <ul className="space-y-2">{filed.map((c) => <CaptureRow key={c.id} c={c} />)}</ul>
        ) : (
          <p className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">Nothing filed yet. Attach a capture to a job/customer/estimate and it’ll live here permanently.</p>
        )}
      </section>
    </div>
  );
}
