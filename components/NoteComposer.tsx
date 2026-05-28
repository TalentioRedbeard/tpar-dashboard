"use client";

// Shared composer for team notes. mode="whiteboard" posts to the company feed;
// mode="teammate" shows a recipient picker and sends to that person's inbox.
// Both support an optional attachment (job/customer/estimate/url) and tags.

import { useState, useEffect, useActionState } from "react";
import { postNote, type PostResult, type Recipient } from "../app/notes/board-actions";

const INITIAL: PostResult = { ok: false, message: "" };

export function NoteComposer({
  mode,
  recipients = [],
  signedInAs,
}: {
  mode: "whiteboard" | "teammate";
  recipients?: Recipient[];
  signedInAs: string | null;
}) {
  const [body, setBody] = useState("");
  const [attachKind, setAttachKind] = useState("");
  const [state, formAction, pending] = useActionState(postNote, INITIAL);

  // Clear the body after a successful post (the feed below revalidates).
  useEffect(() => {
    if (state.ok) { setBody(""); setAttachKind(""); }
  }, [state.ok]);

  return (
    <form action={formAction} className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <input type="hidden" name="target_kind" value={mode} />

      {mode === "teammate" ? (
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Send to</span>
          <select
            name="target_email"
            required
            defaultValue=""
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          >
            <option value="" disabled>Pick a teammate…</option>
            {recipients.map((r) => (
              <option key={r.email} value={r.email}>{r.label}</option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {mode === "whiteboard" ? "Post to the whiteboard" : "Your note"}
        </span>
        <textarea
          name="body"
          required
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={mode === "whiteboard"
            ? "Share with the whole company — a heads-up, a question, a win…"
            : "What do they need to know?"}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        <div className="mt-1 flex items-center justify-between text-xs text-neutral-400">
          <span>{body.length} / 5000</span>
          <span>From: {signedInAs ?? "—"}</span>
        </div>
      </label>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block flex-1 min-w-40">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Tags (optional)</span>
          <input
            type="text"
            name="tags"
            placeholder="scheduling, question, win"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Attach</span>
          <select
            name="attach_kind"
            value={attachKind}
            onChange={(e) => setAttachKind(e.target.value)}
            className="mt-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          >
            <option value="">none</option>
            <option value="job">Job #</option>
            <option value="customer">Customer</option>
            <option value="estimate">Estimate</option>
            <option value="url">Link</option>
          </select>
        </label>
        {attachKind ? (
          <label className="block flex-1 min-w-40">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {attachKind === "url" ? "URL" : attachKind === "job" ? "Job / invoice #" : `${attachKind} id`}
            </span>
            <input
              type="text"
              name="attach_ref"
              placeholder={attachKind === "job" ? "e.g. 27691250 or job_…" : attachKind === "url" ? "https://…" : "id"}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" name="urgent" value="1" className="h-4 w-4 rounded border-neutral-300" />
          🚨 Urgent
        </label>
        <button
          type="submit"
          disabled={pending || body.trim().length === 0}
          className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:bg-neutral-300"
        >
          {pending ? "Sending…" : mode === "whiteboard" ? "Post" : "Send"}
        </button>
      </div>

      {state.message ? (
        <div className={`rounded-md border p-2 text-sm ${state.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
          {state.message}
        </div>
      ) : null}
    </form>
  );
}
