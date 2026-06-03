"use client";

// Dispatch "Note to Danny" composer (Danny 2026-05-31). Drops a note into the
// owner's queue (+ Slack ping) for requirement/skillset gaps or anything else
// for Danny. The receiving window lives on his home dashboard (owner-only).

import { useState, useTransition } from "react";
import { sendNoteToDanny } from "../lib/tasks";

export function NoteToDanny() {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function send() {
    setMsg(null);
    start(async () => {
      const r = await sendNoteToDanny(body);
      if (r.ok) { setBody(""); setMsg("Sent to Danny ✓"); }
      else setMsg(r.error);
    });
  }

  return (
    <div className="rounded-2xl border border-amber-200 border-t-[3px] border-t-amber-400 bg-amber-50/50 p-4">
      <h3 className="mb-2 text-sm font-semibold text-amber-900">📨 Note to Danny</h3>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder="A requirement to add, a skillset gap, anything Danny should see…"
        className="w-full rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
      />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={pending || !body.trim()} onClick={send} className="rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
          {pending ? "Sending…" : "Send to Danny"}
        </button>
        {msg ? <span className="text-xs text-amber-800">{msg}</span> : null}
      </div>
      <div className="mt-1 text-[10px] text-amber-700/70">Lands on Danny&apos;s dashboard + Slack. Use it whenever a task needs a requirement or skillset he should add.</div>
    </div>
  );
}
