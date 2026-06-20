"use client";

// "Send to customer (tracked) →" — the v1 send trigger on the estimate detail
// page. Calls sendEstimateToCustomer (Resend lane), shows the resulting hosted
// view URL, and surfaces a recipient-email override field when the customer has
// no email on file. Writer-gated server-side; the button is only rendered for
// canWrite users.

import { useState, useTransition } from "react";
import { sendEstimateToCustomer } from "./actions";

export function SendEstimateButton({ id, hasHcpEstimate }: { id: string; hasHcpEstimate: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [toEmail, setToEmail] = useState("");

  function send() {
    setErr(null);
    start(async () => {
      const res = await sendEstimateToCustomer(id, showEmail && toEmail.trim() ? { toEmail: toEmail.trim() } : undefined);
      if (res.ok) {
        setSent(true);
        setViewUrl(res.view_url);
        setShowEmail(false);
      } else {
        setErr(res.error);
        // If it's a missing-email error, reveal the override field.
        if (/email on file/i.test(res.error)) setShowEmail(true);
      }
    });
  }

  if (!hasHcpEstimate) return null;

  return (
    <div className="flex flex-col items-start gap-2">
      {!sent ? (
        <button
          type="button"
          onClick={send}
          disabled={pending}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send to customer (tracked) →"}
        </button>
      ) : (
        <span className="rounded-md bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
          Sent ✓ — we&rsquo;ll track delivery + opens
        </span>
      )}

      {showEmail && !sent ? (
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={toEmail}
            onChange={(e) => setToEmail(e.target.value)}
            placeholder="recipient@email.com"
            className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-navy-700 focus:outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={pending || !toEmail.trim()}
            className="rounded-md bg-navy-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-900 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      ) : null}

      {viewUrl ? (
        <a href={viewUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 hover:underline">
          View the customer&rsquo;s page ↗
        </a>
      ) : null}
      {err ? <div className="text-xs text-red-600">{err}</div> : null}
    </div>
  );
}
