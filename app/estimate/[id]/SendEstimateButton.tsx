"use client";

// "Send to customer (tracked)" — preview-then-confirm (plan 2026-07-13
// section 3.3 guardrail b). Click 1 resolves the recipient + live HCP state
// via the SAME edge-fn logic that will do the send (dry_run); the confirm
// button names the exact resolved email so nobody sends blind. Terminal HCP
// states block the confirm. Sender-gated server-side (requireSender).

import { useState, useTransition } from "react";
import { previewEstimateSend, previewEstimateEmail, sendEstimateToCustomer, type SendPreview } from "./actions";

export function SendEstimateButton({ id, hasHcpEstimate }: { id: string; hasHcpEstimate: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<(SendPreview & { ok: true }) | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [toEmail, setToEmail] = useState("");
  const [message, setMessage] = useState("");
  const [emailHtml, setEmailHtml] = useState<{ html: string; subject: string } | null>(null);

  function openEmailPreview() {
    if (pending) return;
    setErr(null);
    start(async () => {
      const p = await previewEstimateEmail(id);
      if (p.ok) setEmailHtml({ html: p.html, subject: p.subject });
      else setErr(p.error);
    });
  }

  function loadPreview(overrideEmail?: string) {
    setErr(null);
    start(async () => {
      const p = await previewEstimateSend(id, overrideEmail);
      if (p.ok) setPreview(p);
      else { setPreview(null); setErr(p.error); }
    });
  }

  function confirmSend() {
    if (!preview?.toEmail || preview.terminal) return;
    setErr(null);
    // The send must go to exactly the address the confirm button named: if the
    // preview was built from an override, keep sending that override even if
    // the input field was edited/cleared after the re-check.
    const overrideForSend =
      preview.recipientSource === "override" ? preview.toEmail : toEmail.trim() || undefined;
    start(async () => {
      const res = await sendEstimateToCustomer(
        id,
        {
          ...(overrideForSend ? { toEmail: overrideForSend } : {}),
          ...(message.trim() ? { message: message.trim() } : {}),
        },
      );
      if (res.ok) {
        setSent(true);
        setViewUrl(res.view_url);
        setPreview(null);
      } else {
        setErr(res.error);
      }
    });
  }

  if (!hasHcpEstimate) return null;

  if (sent) {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="rounded-md bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
          Sent ✓ — we&rsquo;ll track delivery + opens
        </span>
        {viewUrl ? (
          <a href={viewUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 hover:underline">
            View the customer&rsquo;s page ↗
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {!preview ? (
        <button
          type="button"
          onClick={() => loadPreview()}
          disabled={pending}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-50"
        >
          {pending ? "Checking…" : "Send to customer (tracked) →"}
        </button>
      ) : (
        <div className="w-80 rounded-2xl border-2 border-brand-200 bg-white p-3 text-left shadow-lg">
          {preview.terminal ? (
            <p className="mb-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">
              This estimate is <span className="font-semibold">{preview.hcpWorkStatus}</span> in HCP — sending it would
              confuse the customer, so it&rsquo;s blocked.
            </p>
          ) : preview.toEmail ? (
            <p className="mb-2 text-sm text-neutral-800">
              Will send{preview.options ? ` ${preview.options} option${preview.options === 1 ? "" : "s"}` : ""} to{" "}
              <span className="font-semibold">{preview.toEmail}</span>
              <span className="text-xs text-neutral-500">
                {" "}
                ({preview.recipientSource === "override"
                  ? "your override"
                  : preview.recipientSource === "hcp_record"
                    ? "email on the HCP estimate"
                    : "email on the customer record"}
                {preview.customerName ? ` · ${preview.customerName}` : ""})
              </span>
            </p>
          ) : (
            <p className="mb-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              No email on file for this customer — enter a recipient below.
            </p>
          )}

          <input
            type="email"
            value={toEmail}
            onChange={(e) => setToEmail(e.target.value)}
            placeholder={preview.toEmail ? "different recipient (optional)" : "recipient@email.com"}
            className="mb-2 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="personal note at the top of the email (optional)"
            rows={2}
            className="mb-2 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openEmailPreview}
              disabled={pending}
              className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              title="See the exact email the customer would receive"
            >
              👁 Preview
            </button>
            {toEmail.trim() && toEmail.trim() !== preview.toEmail ? (
              <button
                type="button"
                onClick={() => loadPreview(toEmail.trim())}
                disabled={pending}
                className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                Re-check
              </button>
            ) : (
              <button
                type="button"
                onClick={confirmSend}
                disabled={pending || preview.terminal || !preview.toEmail}
                className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:opacity-40"
              >
                {pending ? "Sending…" : `Send to ${preview.toEmail ?? "…"}`}
              </button>
            )}
            <button
              type="button"
              onClick={() => { setPreview(null); setErr(null); }}
              disabled={pending}
              className="rounded-md px-2 py-1.5 text-sm text-neutral-500 hover:text-neutral-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {err ? <div className="max-w-80 text-xs text-red-600">{err}</div> : null}

      {emailHtml ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setEmailHtml(null)}
        >
          <div
            className="flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-2.5">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">What the customer sees</div>
                <div className="truncate text-sm font-semibold text-neutral-900">{emailHtml.subject}</div>
              </div>
              <button
                type="button"
                onClick={() => setEmailHtml(null)}
                className="rounded-md border border-neutral-300 px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-50"
              >
                Close
              </button>
            </div>
            <iframe title="Email preview" srcDoc={emailHtml.html} sandbox="" className="w-full flex-1 bg-white" />
            <div className="border-t border-neutral-200 px-4 py-2 text-[11px] text-neutral-500">
              The &ldquo;View your estimate&rdquo; button opens the hosted page — send yourself a [TEST] from /estimates to click through it for real.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
