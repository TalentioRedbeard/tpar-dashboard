"use client";

// Lazy, private playback for a recording: fetches a short-lived signed URL only
// when the user hits Play (the audio bucket stays private — no eager signing).

import { useState } from "react";
import { getRecordingSignedUrl } from "../lib/recordings";

export function RecordingPlayer({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (url) return <audio src={url} controls autoPlay className="h-8 w-full max-w-sm" />;

  async function play() {
    setLoading(true);
    setErr(null);
    const r = await getRecordingSignedUrl(id);
    setLoading(false);
    if (r.ok) setUrl(r.url);
    else setErr(r.error);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={loading}
        onClick={play}
        className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
      >
        {loading ? "…" : "▶ Play"}
      </button>
      {err ? <span className="text-xs text-red-600">{err}</span> : null}
    </span>
  );
}
