"use client";

// Inline disposition picker for any /dispatch item. Compact chip + ▾; expands to
// a grouped menu: ACTIVE statuses (stay on the board) and CLEAR/PAUSE statuses
// (collapse the item out of the live lists) + optional note + remove.

import { useState, useTransition, useRef, useEffect } from "react";
import { setDispatchAck } from "./actions";
import {
  type DispatchAckStatus,
  type DispatchItemType,
  ACTIVE_STATUSES,
  RESOLVING_STATUSES,
  isResolving,
  dispositionChip,
  dispositionLabel,
  DISPOSITION_HINT,
} from "./dispositions";

type Existing = {
  status: DispatchAckStatus;
  note: string | null;
  set_by_short_name: string | null;
  set_at: string;
} | null;

export function DispatchAck({
  itemType,
  itemId,
  hcpJobId,
  existing,
  canWrite = true,
}: {
  itemType: DispatchItemType;
  itemId: string;
  hcpJobId?: string | null;
  existing: Existing;
  canWrite?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState(existing?.note ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    if (hcpJobId) fd.set("hcp_job_id", hcpJobId);
    fd.set("status", status);
    if (status !== "clear") fd.set("note", note);
    startTransition(async () => {
      const result = await setDispatchAck({ ok: false, message: "" }, fd);
      setMsg(result.ok ? result.message : `err: ${result.message}`);
      // Resolving (or clear) collapses the item — close the picker.
      if (result.ok && (status === "clear" || isResolving(status as DispatchAckStatus))) setOpen(false);
    });
  }

  const chip = dispositionChip(existing?.status);
  const label = dispositionLabel(existing?.status);

  if (!canWrite && !existing) return null;

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => canWrite && setOpen((o) => !o)}
        disabled={!canWrite}
        title={existing ? `${label} by ${existing.set_by_short_name ?? "?"} · ${new Date(existing.set_at).toLocaleString()}${existing.note ? "\n" + existing.note : ""}` : "Set status / clear with a reason"}
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${chip} ${canWrite ? "hover:opacity-80 cursor-pointer" : ""}`}
      >
        <span>{label}</span>
        {canWrite ? <span aria-hidden className="text-[8px] opacity-60">▾</span> : null}
      </button>

      {open && canWrite ? (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-neutral-300 bg-white p-2 shadow-lg">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Active — stays on the board</div>
          <div className="space-y-0.5">
            {ACTIVE_STATUSES.map((s) => (
              <StatusButton key={s} status={s} onClick={() => submit(s)} pending={pending} />
            ))}
          </div>
          <div className="mb-1 mt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Clear / pause — collapses it</div>
          <div className="space-y-0.5">
            {RESOLVING_STATUSES.map((s) => (
              <StatusButton key={s} status={s} onClick={() => submit(s)} pending={pending} />
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional note (≤500 chars) — esp. for declined / awaiting-client"
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
              Remove status (back to unset)
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
      title={DISPOSITION_HINT[status]}
      className={`block w-full rounded-md px-2 py-1 text-left text-[11px] font-medium ${dispositionChip(status)} hover:opacity-80`}
    >
      {dispositionLabel(status)}
      <span className="ml-1 font-normal opacity-60">· {DISPOSITION_HINT[status]}</span>
    </button>
  );
}
