"use client";

// Owner-only receiving window for "Note to Danny" (Danny 2026-05-31). Lives on
// his home dashboard. Lists requirement/skillset flags + anything sent, with
// mark-read. Voice notes get a private signed-URL player.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markDannyNoteRead, type DannyNote } from "../lib/tasks";
import { getRecordingSignedUrl } from "../lib/recordings";

export function NotesToDannyInbox({ notes }: { notes: DannyNote[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const unread = notes.filter((n) => !n.read_at).length;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
      <h3 className="mb-2 text-sm font-semibold text-amber-900">📨 Notes to me{unread ? ` · ${unread} new` : ""}</h3>
      {notes.length === 0 ? (
        <div className="text-sm text-neutral-500">No notes yet.</div>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className={`rounded-xl border p-2 text-sm ${n.read_at ? "border-neutral-200 bg-white opacity-70" : "border-amber-300 bg-white"}`}>
              <div className="text-xs text-neutral-500">
                {n.author_short_name ?? "?"} · {new Date(n.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </div>
              <div className="mt-0.5 whitespace-pre-wrap text-neutral-800">{n.body}</div>
              {n.tags?.includes("voice") && n.attach_ref ? <VoiceNotePlayer id={n.attach_ref} /> : null}
              {!n.read_at ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => start(async () => { await markDannyNoteRead(n.id); router.refresh(); })}
                  className="mt-1 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[10px] text-neutral-600 hover:bg-neutral-50"
                >
                  Mark read
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VoiceNotePlayer({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    const r = await getRecordingSignedUrl(id);
    setLoading(false);
    if (r.ok) setUrl(r.url);
    else setErr(r.error);
  }

  if (url) return <audio controls src={url} className="mt-1 w-full" />;
  return (
    <button type="button" onClick={load} disabled={loading} className="mt-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100">
      {loading ? "loading…" : err ? `⚠ ${err}` : "▶ Play voice note"}
    </button>
  );
}
