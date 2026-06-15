"use client";

// "📞 Call" button (Slice 3 call-bridge). Rings the operator's own phone, then
// bridges to the contact with the TPAR business caller ID. Used on /contacts
// rows; the same action works for customer/job pages later.

import { useState, useTransition } from "react";
import { startCallBridge } from "../lib/call-bridge-actions";

export function CallContactButton({
  phone,
  name,
  kind,
  hcpCustomerId,
  hcpJobId,
  enabled = true,
}: {
  phone: string;
  name: string;
  kind?: string;
  hcpCustomerId?: string;
  hcpJobId?: string;
  /** When false, the button renders disabled (capability shipped but turned off). */
  enabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!enabled) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400"
        title="Client calling is turned off. Enable CUSTOMER_VOICE_CALL_ENABLED to allow calling clients from the business line."
      >
        📞 Call (off)
      </span>
    );
  }

  function go() {
    setErr(null);
    setMsg(null);
    start(async () => {
      const r = await startCallBridge({ contactPhone: phone, contactName: name, contactKind: kind, hcpCustomerId, hcpJobId });
      if (r.ok) setMsg("📞 Calling your phone — answer it and we'll connect you.");
      else setErr(r.error);
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        title="Rings your phone first, then connects you to this contact with the business caller ID."
        className="rounded-md bg-white/60 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700 hover:bg-white disabled:opacity-50"
      >
        {pending ? "Calling…" : "📞 Call"}
      </button>
      {msg ? <span className="text-[10px] text-emerald-700">{msg}</span> : null}
      {err ? <span className="text-[10px] text-red-700">{err}</span> : null}
    </span>
  );
}
