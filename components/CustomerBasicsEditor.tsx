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
  const setAddr = (k: keyof CustomerBasicsInitial["address"], v: string) => setF((p) => ({ ...p, address: { ...p.address, [k]: v } }));

  function save() {
    setErr(null);
    // Diff vs initial — send only what changed.
    const payload: CustomerBasicsInput = { hcp_customer_id: hcpCustomerId };
    if (f.first_name.trim() !== initial.first_name.trim()) payload.first_name = f.first_name.trim();
    if (f.last_name.trim() !== initial.last_name.trim()) payload.last_name = f.last_name.trim();
    if (f.email.trim() !== initial.email.trim()) payload.email = f.email.trim();
    if (f.mobile_number.trim() !== initial.mobile_number.trim()) payload.mobile_number = f.mobile_number.trim();
    const a = f.address, ia = initial.address;
    const addr: NonNullable<CustomerBasicsInput["address"]> = {};
    if (a.street.trim() !== ia.street.trim()) addr.street = a.street.trim();
    if (a.street_line_2.trim() !== ia.street_line_2.trim()) addr.street_line_2 = a.street_line_2.trim();
    if (a.city.trim() !== ia.city.trim()) addr.city = a.city.trim();
    if (a.state.trim() !== ia.state.trim()) addr.state = a.state.trim();
    if (a.zip.trim() !== ia.zip.trim()) addr.zip = a.zip.trim();
    if (Object.keys(addr).length > 0) { addr.address_id = ia.address_id; payload.address = addr; }
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
              Name, phone, email + address <span className="font-semibold">write through to Housecall Pro</span> — the change is real and survives the next sync. Do-not-text/call + display name stay internal to TPAR.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>First name</label><input className={input} value={f.first_name} disabled={pending} onChange={(e) => set("first_name", e.target.value)} /></div>
              <div><label className={lbl}>Last name</label><input className={input} value={f.last_name} disabled={pending} onChange={(e) => set("last_name", e.target.value)} /></div>
              <div><label className={lbl}>Mobile phone</label><input className={input} value={f.mobile_number} disabled={pending} inputMode="tel" placeholder="9188451341" onChange={(e) => set("mobile_number", e.target.value)} /></div>
              <div><label className={lbl}>Email</label><input className={input} value={f.email} disabled={pending} inputMode="email" onChange={(e) => set("email", e.target.value)} /></div>
            </div>

            <div className="mt-4 border-t border-neutral-100 pt-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Address</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className={lbl}>Street</label><input className={input} value={f.address.street} disabled={pending} onChange={(e) => setAddr("street", e.target.value)} /></div>
                <div className="col-span-2"><label className={lbl}>Street line 2</label><input className={input} value={f.address.street_line_2} disabled={pending} onChange={(e) => setAddr("street_line_2", e.target.value)} /></div>
                <div><label className={lbl}>City</label><input className={input} value={f.address.city} disabled={pending} onChange={(e) => setAddr("city", e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={lbl}>State</label><input className={input} value={f.address.state} disabled={pending} maxLength={2} onChange={(e) => setAddr("state", e.target.value.toUpperCase())} /></div>
                  <div><label className={lbl}>ZIP</label><input className={input} value={f.address.zip} disabled={pending} inputMode="numeric" onChange={(e) => setAddr("zip", e.target.value)} /></div>
                </div>
              </div>
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
