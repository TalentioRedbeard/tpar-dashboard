"use client";

// Owner Dev-inbox card (phone→dev tether Rung 1). Spoken dev thoughts from
// walks/calls land here; the bridge's replies show inline when they exist.
// Verbs: promote-to-task (flags pattern), done, dismiss.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { devInboxVerb, type DevInboxRow } from "@/lib/dev-inbox-actions";

const STATUS_TONE: Record<string, string> = {
  new: "bg-brand-100 text-brand-800",
  picked: "bg-amber-100 text-amber-800",
  replied: "bg-emerald-100 text-emerald-800",
};
const SOURCE_ICON: Record<string, string> = { call: "📞", recording: "🎙️", office: "🏢" };

export function DevInboxCard({ rows }: { rows: DevInboxRow[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const act = (id: number, verb: "done" | "dismissed" | "promoted") => {
    setErr(null);
    startTransition(async () => {
      const r = await devInboxVerb({ id, verb });
      if (!r.ok) { setErr(r.error ?? "Failed."); return; }
      router.refresh();
    });
  };

  if (rows.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Empty. Call the TPAR line and open with “dev note…” — or just talk shop; the classifier
        files it. Last night&apos;s recordings sweep in automatically.
      </p>
    );
  }

  return (
    <div>
      {err ? <div className="mb-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-900">{err}</div> : null}
      <ul className="divide-y divide-neutral-100">
        {rows.map((r) => (
          <li key={r.id} className="py-2.5 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-navy-900">
                  <span aria-hidden className="mr-1">{SOURCE_ICON[r.source] ?? "•"}</span>
                  {r.transcript}
                </div>
                {r.reply ? (
                  <div className="mt-1 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-900">
                    <span className="font-semibold">Claude:</span> {r.reply}
                  </div>
                ) : null}
                <div className="mt-0.5 text-[11px] text-neutral-400">
                  {new Date(r.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {r.call_sid ? " · from a call" : ""}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[r.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                {r.status}
              </span>
            </div>
            <div className="mt-1.5 flex gap-2">
              <button type="button" disabled={pending} onClick={() => act(r.id, "promoted")}
                className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
                → Task
              </button>
              <button type="button" disabled={pending} onClick={() => act(r.id, "done")}
                className="rounded-md bg-neutral-200 px-2.5 py-1 text-xs font-semibold text-navy-900 hover:bg-neutral-300 disabled:opacity-50">
                Done
              </button>
              <button type="button" disabled={pending} onClick={() => act(r.id, "dismissed")}
                className="rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-200 disabled:opacity-50">
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
