"use client";

// SMS notification controls on /inbox.
// - Everyone: personal "text me when I get a note" toggle (opt-out).
// - Owner only: master switch that gates ALL outbound texts (ships OFF).

import { useState, useTransition } from "react";
import { setMySmsOptOut, setSmsEnabled } from "../app/notes/board-actions";

export function SmsSettings({
  optedOut,
  isOwner,
  smsEnabled,
}: {
  optedOut: boolean;
  isOwner: boolean;
  smsEnabled: boolean;
}) {
  const [optOut, setOptOut] = useState(optedOut);
  const [enabled, setEnabled] = useState(smsEnabled);
  const [pending, start] = useTransition();

  return (
    <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-neutral-700">
          <input
            type="checkbox"
            checked={!optOut}
            disabled={pending}
            onChange={(e) => {
              const next = !e.target.checked; // checked = receive texts = NOT opted out
              setOptOut(next);
              start(async () => { await setMySmsOptOut(next); });
            }}
            className="h-4 w-4 rounded border-neutral-300"
          />
          Text me when I get a note
        </label>

        {isOwner ? (
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${enabled ? "text-emerald-700" : "text-neutral-500"}`}>
              Team texts: {enabled ? "ON" : "OFF"}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const next = !enabled;
                setEnabled(next);
                start(async () => { await setSmsEnabled(next); });
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${enabled ? "bg-neutral-600 hover:bg-neutral-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
            >
              {enabled ? "Turn off" : "Turn on (go live)"}
            </button>
          </div>
        ) : null}
      </div>
      {isOwner && !enabled ? (
        <p className="mt-2 text-xs text-neutral-500">
          Texts are off — no SMS is sent to anyone. Turning on texts the recipient on every teammate note (skips opted-out people and quiet hours 9pm–7am).
        </p>
      ) : null}
    </div>
  );
}
