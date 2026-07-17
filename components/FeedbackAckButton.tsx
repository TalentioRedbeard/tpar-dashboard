"use client";

// "Got it" — collapses an answered feedback item into history (Heard card).

import { useState, useTransition } from "react";
import { ackFeedbackItem } from "@/app/me/feedback-ack-action";

export function FeedbackAckButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  if (gone) return <span className="text-xs text-emerald-600">✓</span>;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { const r = await ackFeedbackItem(id); if (r.ok) setGone(true); })}
      className="shrink-0 rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
    >
      {pending ? "…" : "Got it"}
    </button>
  );
}
