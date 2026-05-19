"use client";

// Inline ack picker for any /dispatch item. Compact by default (just a chip
// + ▾). Expands on click to show all 4 statuses + optional note input + "clear".
//
// Optimistic-ish: posts via server action, revalidates the page.

import { useState, useTransition, useRef, useEffect } from "react";
import { setDispatchAck, type DispatchAckStatus, type DispatchItemType } from "./actions";

type Existing = {
  status: DispatchAckStatus;
  note: string | null;
  set_by_short_name: string | null;
  set_at: string;
} | null;

export function DispatchAck({
  itemType,
  itemId,
  existing,
  canWrite = true,
}: {
  itemType: DispatchItemType;
  itemId: string;
  existing: Existing;
  canWrite?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState(existing?.note ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function submit(status: DispatchAckStatus | "clear") {
    const fd = new FormData();
    fd.set("item_type", itemType);
    fd.set("item_id", itemId);
    fd.set("status", status);
    if (status !== "clear") fd.set("note", note);
    startTransition(async () => {
      const result = await setDispatchAck({ ok: false, message: "" }, fd);
      setMsg(result.ok ? result.message : `err: ${result.message}`);
      if (result.ok && (status === "addressed" || status === "clear")) {
        setOpen(false);
      }
    });
  }

  const chipClasses = chipFor(existing?.status);
  const label = labelFor(existing?.status);

  if (!canWrite && !existing) {
    return null;  // hide if no perms + nothing to show
  }

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => canWrite && setOpen((o) => !o)}
        disabled={!canWrite}
        title={existing ? `${label} by ${existing.set_by_short_name ?? "?"} · ${new Date(existing.set_at).toLocaleString()}${existing.note ? "\n" + existing.note : ""}` : "Set status"}
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${chipClasses} ${canWrite ? "hover:opacity-80 cursor-pointer" : ""}`}
      >
        <span>{label}</span>
        {canWrite ? <span aria-hidden className="text-[8px] opacity-60">▾</span> : null}
      </button>

      {open && canWrite ? (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-neutral-300 bg-white p-2 shadow-lg">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">Set status</div>
          <div className="space-y-1">
            <StatusButton onClick={() => submit("addressed")} status="addressed" pending={pending} />
            <StatusButton onClick={() => submit("needs_followup")} status="needs_followup" pending={pending} />
            <StatusButton onClick={() => submit("needs_review")} status="needs_review" pending={pending} />
            <StatusButton onClick={() => submit("needs_advise")} status="needs_advise" pending={pending} />
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional note (≤500 chars)"
            rows={2}
            className="mt-2 w-full rounded-md border border-neutral-200 px-2 py-1 text-[11px]"
          />
          {existing ? (
            <button
              type="button"
              onClick={() => submit("clear")}
              disabled={pending}
              className="mt-1 w-full rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-[10px] text-neutral-600 hover:bg-neutral-100"
            >
              Clear status
            </button>
          ) : null}
          {msg ? <div className="mt-1 text-[10px] text-neutral-600">{msg}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusButton({ status, onClick, pending }: { status: DispatchAckStatus; onClick: () => void; pending: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`block w-full rounded-md px-2 py-1 text-left text-[11px] font-medium ${chipFor(status)} hover:opacity-80`}
    >
      {labelFor(status)}
    </button>
  );
}

function chipFor(status: DispatchAckStatus | undefined): string {
  switch (status) {
    case "addressed":      return "bg-emerald-100 text-emerald-800 border border-emerald-200";
    case "needs_followup": return "bg-amber-100 text-amber-800 border border-amber-200";
    case "needs_review":   return "bg-sky-100 text-sky-800 border border-sky-200";
    case "needs_advise":   return "bg-violet-100 text-violet-800 border border-violet-200";
    default:               return "bg-neutral-50 text-neutral-500 border border-dashed border-neutral-300";
  }
}

function labelFor(status: DispatchAckStatus | undefined): string {
  switch (status) {
    case "addressed":      return "✓ addressed";
    case "needs_followup": return "↻ follow-up";
    case "needs_review":   return "👁 review";
    case "needs_advise":   return "❓ advise";
    default:               return "+ status";
  }
}
