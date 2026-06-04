"use client";

// Reusable "text this client" composer. Wraps the existing sendComms server
// action (app/comms/new/actions.ts) so the customer + job pages get the same
// tested send-path that /comms/new uses: fires Twilio via send-sms (from the
// TPAR Twilio line) and logs to text_messages + communication_events, so the
// outbound text threads into customer_360 / comms / /ask.
//
// Collapsed to a single "💬 Text" button; expands to phone (prefilled, editable)
// + message + Send. Inbound replies come back via the twilio-inbound-sms webhook.

import { useActionState, useState, useEffect, useRef } from "react";
import { sendComms, type SendResult } from "../app/comms/new/actions";

const INITIAL: SendResult = { ok: false, message: "" };

export function QuickText({
  defaultPhone,
  hcpCustomerId = null,
  hcpJobId = null,
  label = "Text",
}: {
  defaultPhone: string | null;
  hcpCustomerId?: string | null;
  hcpJobId?: string | null;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(sendComms, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the message box after a successful send (keep the panel open so the
  // sender sees the confirmation + can send a follow-up).
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
        title={defaultPhone ? `Text ${defaultPhone}` : "No phone on file"}
      >
        💬 {label}
      </button>

      {open ? (
        <form ref={formRef} action={action} className="mt-2 w-72 rounded-lg border border-neutral-300 bg-white p-3 shadow-sm">
          <input type="hidden" name="mode" value="sms" />
          <input type="hidden" name="recipient_type" value="customer" />
          {hcpCustomerId ? <input type="hidden" name="hcp_customer_id" value={hcpCustomerId} /> : null}
          {hcpJobId ? <input type="hidden" name="hcp_job_id" value={hcpJobId} /> : null}

          <label className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">To</label>
          <input
            name="to"
            type="tel"
            inputMode="tel"
            required
            defaultValue={defaultPhone ?? ""}
            placeholder="(918) 555-1234"
            className="mt-0.5 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />

          <label className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Message</label>
          <textarea
            name="body"
            required
            rows={3}
            maxLength={1000}
            placeholder="Type your message to the client…"
            className="mt-0.5 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />

          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-neutral-400">Sends from the TPAR line</span>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send"}
            </button>
          </div>

          {state.message ? (
            <div className={`mt-2 rounded-md px-2 py-1 text-[11px] ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
              {state.ok ? "✓ " : ""}{state.message}
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
