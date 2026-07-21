"use client";

// "Add note to HCP" box for /job/[id] (Danny 2026-07-21). Posts a note straight
// into Housecall Pro (append-only entry) so it shows in HCP for the whole crew.
// It mirrors back into the Private Notes section on the next HCP sync/webhook.
// Distinct from the TPAR-local job note form lower on the page.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postJobNoteToHcp } from "../lib/notes-actions";

export function HcpJobNoteBox({ hcpJobId }: { hcpJobId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function submit() {
    const content = text.trim();
    if (!content) return;
    setMsg(null);
    start(async () => {
      const res = await postJobNoteToHcp({ hcp_job_id: hcpJobId, content });
      if (!res.ok) { setMsg({ ok: false, text: res.error ?? "Couldn't post." }); return; }
      setText("");
      setOpen(false);
      setMsg({ ok: true, text: "Posted to HCP ✓ — shows here after the next sync." });
      router.refresh();
    });
  }

  return (
    <div className="mt-3 border-t border-amber-200 pt-3">
      {open ? (
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Note to add in Housecall Pro (visible to the crew in HCP)…"
            className="w-full resize-y rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-sm text-neutral-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={pending || !text.trim()}
              className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
            >
              {pending ? "Posting…" : "Post to HCP"}
            </button>
            <button type="button" onClick={() => { setOpen(false); setText(""); }} disabled={pending} className="text-xs text-amber-700 hover:text-amber-900">cancel</button>
            {msg && !msg.ok ? <span className="text-xs text-red-700">{msg.text}</span> : null}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setOpen(true); setMsg(null); }}
            className="rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            ➕ Add note to HCP
          </button>
          {msg?.ok ? <span className="text-xs text-emerald-700">{msg.text}</span> : null}
        </div>
      )}
    </div>
  );
}
