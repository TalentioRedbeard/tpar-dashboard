"use client";

// 🖍️ Edit customer basics — admin/management only (Danny 2026-07-21, Part 3).
// A red-pen affordance by the customer name opens a popup editing the HCP-owned
// basics (name/phone/email/address, write-through to HCP) + TPAR-local overrides.
// Only changed fields are sent. Tech role never sees this (page gates on render).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editCustomerBasics, type CustomerBasicsInput } from "../app/customer/[id]/customer-edit-actions";

export type CustomerBasicsInitial = {
  first_name: string;
  last_name: string;
  email: string;
  mobile_number: string;             // 10-digit or formatted
  notifications_enabled: boolean;    // HCP "Send notifications" master switch
  address: { address_id?: string; street: string; street_line_2: string; city: string; state: string; zip: string };
  display_name_override: string;
  preferred_name: string;
  do_not_text: boolean;
  do_not_call: boolean;
};

const input = "w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-neutral-50";
const lbl = "block text-[11px] font-medium uppercase tracking-wide text-neutral-500 mb-1";

export function CustomerBasicsEditor({ hcpCustomerId, initial }: { hcpCustomerId: string; initial: CustomerBasicsInitial }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // Local form state, seeded from initial each time the modal opens.
  const [f, setF] = useState<CustomerBasicsInitial>(initial);
  const openModal = () => { setF(initial); setErr(null); setOpen(true); };

  const set = <K extends keyof CustomerBasicsInitial>(k: K, v: CustomerBasicsInitial[K]) => setF((p) => ({ ...p, [k]: v }));

  function save() {
    setErr(null);
    // Diff vs initial — send only what changed. Address is NOT sent: HCP's public
    // API doesn't accept address edits (verified), so it's shown read-only with an
    // "Edit in HCP" link instead.
    const payload: CustomerBasicsInput = { hcp_customer_id: hcpCustomerId };
    if (f.first_name.trim() !== initial.first_name.trim()) payload.first_name = f.first_name.trim();
    if (f.last_name.trim() !== initial.last_name.trim()) payload.last_name = f.last_name.trim();
    if (f.email.trim() !== initial.email.trim()) payload.email = f.email.trim();
    if (f.mobile_number.trim() !== initial.mobile_number.trim()) payload.mobile_number = f.mobile_number.trim();
    if (f.notifications_enabled !== initial.notifications_enabled) payload.notifications_enabled = f.notifications_enabled;
    if (f.display_name_override.trim() !== initial.display_name_override.trim()) payload.display_name_override = f.display_name_override.trim();
    if (f.preferred_name.trim() !== initial.preferred_name.trim()) payload.preferred_name = f.preferred_name.trim();
    if (f.do_not_text !== initial.do_not_text) payload.do_not_text = f.do_not_text;
    if (f.do_not_call !== initial.do_not_call) payload.do_not_call = f.do_not_call;

    const nChanged = Object.keys(payload).length - 1; // minus hcp_customer_id
    if (nChanged === 0) { setOpen(false); return; }

    start(async () => {
      const res = await editCustomerBasics(payload);
      if (!res.ok) { setErr(res.error ?? "Couldn't save."); return; }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Edit customer info (name, phone, email, address)"
        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
      >
        🖍️ Edit info
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => !pending && setOpen(false)}>
          <div className="mt-10 w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">Edit customer info</h3>
              <button type="button" onClick={() => !pending && setOpen(false)} className="text-xs text-neutral-500 hover:text-neutral-800">close ×</button>
            </div>
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
              Name, phone, email + the HCP notification switch <span className="font-semibold">write through to Housecall Pro</span> — the change is real and survives the next sync. Do-not-text/call + display name stay internal to TPAR.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>First name</label><input className={input} value={f.first_name} disabled={pending} onChange={(e) => set("first_name", e.target.value)} /></div>
              <div><label className={lbl}>Last name</label><input className={input} value={f.last_name} disabled={pending} onChange={(e) => set("last_name", e.target.value)} /></div>
              <div><label className={lbl}>Mobile phone</label><input className={input} value={f.mobile_number} disabled={pending} inputMode="tel" placeholder="9188451341" onChange={(e) => set("mobile_number", e.target.value)} /></div>
              <div><label className={lbl}>Email</label><input className={input} value={f.email} disabled={pending} inputMode="email" onChange={(e) => set("email", e.target.value)} /></div>
            </div>

            {/* HCP "Send notifications" master switch — write-through. The
                notification-free-testing lever (Danny 2026-07-23): uncheck to run
                test jobs/estimates on this customer without HCP texting them. */}
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5">
              <label className="flex items-start gap-2.5 text-sm text-neutral-800">
                <input type="checkbox" checked={f.notifications_enabled} disabled={pending}
                  onChange={(e) => set("notifications_enabled", e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500" />
                <span>
                  <span className="font-semibold">🔔 Send Housecall Pro notifications</span>
                  <span className="block text-[11px] leading-snug text-neutral-500">
                    Writes through to HCP&rsquo;s customer &ldquo;Send notifications&rdquo; switch. <span className="font-medium text-amber-800">Uncheck to make this customer notification-free</span> — HCP then sends them NO texts or emails at all (appointment, on-my-way, invoices). Use for test customers.
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-4 border-t border-neutral-100 pt-3">
              <div className="mb-1 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Service address</div>
                <a href={`https://pro.housecallpro.com/app/customers/${hcpCustomerId}`} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-brand-700 hover:underline">Edit in HCP ↗</a>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-2 text-sm text-neutral-700">
                {[initial.address.street, initial.address.street_line_2].filter((s) => s.trim()).join(", ") || <span className="text-neutral-400">no address on file</span>}
                {(initial.address.city || initial.address.state || initial.address.zip) ? (
                  <div className="text-neutral-500">{[initial.address.city, initial.address.state].filter((s) => s.trim()).join(", ")} {initial.address.zip}</div>
                ) : null}
              </div>
              <p className="mt-1 text-[10px] text-neutral-400">Housecall Pro’s API doesn’t accept address edits — change it in HCP and it syncs back here.</p>
            </div>

            <div className="mt-4 border-t border-neutral-100 pt-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Internal (TPAR only — never sent to HCP)</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Display name override</label><input className={input} value={f.display_name_override} disabled={pending} placeholder="leave blank to auto" onChange={(e) => set("display_name_override", e.target.value)} /></div>
                <div><label className={lbl}>Preferred name (“goes by”)</label><input className={input} value={f.preferred_name} disabled={pending} onChange={(e) => set("preferred_name", e.target.value)} /></div>
              </div>
              <div className="mt-2 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-neutral-700"><input type="checkbox" checked={f.do_not_text} disabled={pending} onChange={(e) => set("do_not_text", e.target.checked)} className="h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500" /> Do not text</label>
                <label className="flex items-center gap-2 text-sm text-neutral-700"><input type="checkbox" checked={f.do_not_call} disabled={pending} onChange={(e) => set("do_not_call", e.target.checked)} className="h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500" /> Do not call</label>
              </div>
            </div>

            {err ? <div className="mt-3 text-xs text-red-700">{err}</div> : null}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={() => !pending && setOpen(false)} disabled={pending} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:text-neutral-900">Cancel</button>
              <button type="button" onClick={save} disabled={pending} className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                {pending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
