"use client";

import { useState, useActionState } from "react";
import { postNoteToMgmt, type NoteResult } from "./actions";

const INITIAL: NoteResult = { ok: false, message: "" };

export function NoteForm({
  defaultBody,
  defaultUrgent,
  hcpJobId,
  hcpCustomerId,
  signedInAs,
}: {
  defaultBody: string;
  defaultUrgent: boolean;
  hcpJobId: string | null;
  hcpCustomerId: string | null;
  signedInAs: string | null;
}) {
  const [text, setText] = useState(defaultBody);
  const [subjectTags, setSubjectTags] = useState("");
  const [urgent, setUrgent] = useState(defaultUrgent);
  const [state, formAction, pending] = useActionState(postNoteToMgmt, INITIAL);

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <input type="hidden" name="hcp_job_id" value={hcpJobId ?? ""} />
      <input type="hidden" name="hcp_customer_id" value={hcpCustomerId ?? ""} />
      <input type="hidden" name="urgent" value={urgent ? "1" : "0"} />

      {(hcpJobId || hcpCustomerId) && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          {hcpJobId ? <div><span className="font-medium">Attached to job:</span> <code>{hcpJobId.slice(0, 16)}…</code></div> : null}
          {hcpCustomerId ? <div><span className="font-medium">Attached to customer:</span> <code>{hcpCustomerId.slice(0, 16)}…</code></div> : null}
        </div>
      )}

      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-600">Your note</span>
        <textarea
          name="text"
          required
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What does Danny need to know? Be specific."
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <div className="mt-1 flex items-center justify-between text-xs text-neutral-500">
          <span>{text.length} / 5000</span>
          <span>From: {signedInAs ?? "—"}</span>
        </div>
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-600">Tags (optional, comma-separated)</span>
        <input
          type="text"
          name="subject_tags"
          value={subjectTags}
          onChange={(e) => setSubjectTags(e.target.value)}
          placeholder="scheduling, employee, vendor, training"
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={urgent}
          onChange={(e) => setUrgent(e.target.checked)}
          className="h-4 w-4 rounded border-neutral-300"
        />
        <span className="text-neutral-700">🚨 Mark urgent (highlights the Slack DM)</span>
      </label>

      <button
        type="submit"
        disabled={pending || text.trim().length === 0}
        className="w-full rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:bg-neutral-300"
      >
        {pending ? "Logging…" : "Send to Danny"}
      </button>

      {state.message && (
        <div className={`rounded-md border p-2 text-sm ${state.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
          {state.message}
        </div>
      )}
    </form>
  );
}
