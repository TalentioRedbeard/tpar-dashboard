"use client";

// Add/edit a business contact (tpar_contacts). Collapsed "➕ Add contact" button
// by default; opens pre-filled when the page is loaded with ?edit=<id> (the
// per-card "edit" link). On success, returns to /contacts and refreshes.

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { upsertContact, type ContactUpsertResult } from "./actions";

const INITIAL: ContactUpsertResult = { ok: false, error: "" };

const KINDS: Array<{ value: string; label: string }> = [
  { value: "vendor", label: "Vendor" },
  { value: "supply", label: "Supply" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "utility", label: "Utility" },
  { value: "agency", label: "Agency" },
  { value: "emergency", label: "Emergency" },
  { value: "pricing_source", label: "Pricing source" },
  { value: "competitor", label: "Competitor" },
  { value: "other", label: "Other" },
];

export type ContactInitial = {
  id: string;
  name: string;
  kind: string;
  phone_e164: string | null;
  alt_phone: string | null;
  email: string | null;
  website: string | null;
  when_to_call: string | null;
  notes: string | null;
  category_tags: string[];
  status: string;
  is_preferred: boolean;
};

export function ContactEditor({ initial }: { initial?: ContactInitial | null }) {
  const [open, setOpen] = useState(!!initial);
  const [state, formAction, pending] = useActionState(upsertContact, INITIAL);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      // Clear ?edit and pull fresh data.
      router.push("/contacts");
      router.refresh();
    }
  }, [state, router]);

  const i = initial ?? null;
  const inputCls = "mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm";

  if (!open) {
    return (
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          ➕ Add contact
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="mb-5 space-y-3 rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">{i ? `Edit ${i.name}` : "Add a contact"}</h2>
        <button
          type="button"
          onClick={() => { setOpen(false); if (i) { router.push("/contacts"); } }}
          className="text-xs text-neutral-500 hover:underline"
        >
          Cancel
        </button>
      </div>

      {i ? <input type="hidden" name="id" value={i.id} /> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block text-xs">
          <span className="font-medium text-neutral-600">Name *</span>
          <input name="name" required defaultValue={i?.name ?? ""} className={inputCls} placeholder="Ferguson — Tulsa branch" />
        </label>
        <label className="block text-xs">
          <span className="font-medium text-neutral-600">Type *</span>
          <select name="kind" defaultValue={i?.kind ?? "vendor"} className={inputCls}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="block text-xs">
          <span className="font-medium text-neutral-600">Phone (textable/callable)</span>
          <input name="phone" defaultValue={i?.phone_e164 ?? ""} className={inputCls} placeholder="918-555-1234 or +19185551234" />
        </label>
        <label className="block text-xs">
          <span className="font-medium text-neutral-600">Alt phone</span>
          <input name="alt_phone" defaultValue={i?.alt_phone ?? ""} className={inputCls} placeholder="optional" />
        </label>
        <label className="block text-xs">
          <span className="font-medium text-neutral-600">Email</span>
          <input name="email" type="email" defaultValue={i?.email ?? ""} className={inputCls} placeholder="optional" />
        </label>
        <label className="block text-xs">
          <span className="font-medium text-neutral-600">Website</span>
          <input name="website" defaultValue={i?.website ?? ""} className={inputCls} placeholder="https://…" />
        </label>
      </div>

      <label className="block text-xs">
        <span className="font-medium text-neutral-600">When to call / use</span>
        <input name="when_to_call" defaultValue={i?.when_to_call ?? ""} className={inputCls} placeholder="e.g. PEX + fittings; primary supply" />
      </label>

      <label className="block text-xs">
        <span className="font-medium text-neutral-600">Category tags (comma-separated)</span>
        <input name="category_tags" defaultValue={(i?.category_tags ?? []).join(", ")} className={inputCls} placeholder="plumbing-supply, primary, local" />
      </label>

      <label className="block text-xs">
        <span className="font-medium text-neutral-600">Notes</span>
        <textarea name="notes" rows={2} defaultValue={i?.notes ?? ""} className={inputCls} placeholder="Account #, rep name, lead time…" />
      </label>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs">
          <span className="font-medium text-neutral-600">Status</span>
          <select name="status" defaultValue={i?.status ?? "active"} className="rounded-md border border-neutral-300 px-2 py-1 text-sm">
            <option value="active">active</option>
            <option value="research_candidate">research candidate</option>
            <option value="inactive">inactive (hide)</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" name="is_preferred" defaultChecked={!!i?.is_preferred} />
          <span className="font-medium text-neutral-600">⭐ Preferred</span>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:bg-neutral-300"
        >
          {pending ? "Saving…" : i ? "Save changes" : "Add contact"}
        </button>
      </div>

      {!state.ok && state.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>
      ) : null}
    </form>
  );
}
