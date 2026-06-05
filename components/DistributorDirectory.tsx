"use client";

// Distributor directory for /shopping. Cards show contact info + (for enabled
// vendors) an "Email order/quote" button that opens a pre-filled mailto with the
// current open needs. Admins get add/edit/remove. No auto-send — the user
// reviews and sends from their own mail client.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  upsertDistributor,
  deleteDistributor,
  type Distributor,
  type DistributorInput,
} from "@/app/shopping/distributor-actions";
import type { SupplierLocation } from "@/app/shopping/location-actions";

export type NeedLine = { qty: string | number | null; item: string };

const telHref = (p: string) => `tel:${p.replace(/[^0-9+]/g, "")}`;

function CopyBtn({ text, label = "copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* ignore */ } }}
      className="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 transition hover:bg-neutral-50"
      title="Copy number to dial from your phone"
    >
      {done ? "✓ copied" : label}
    </button>
  );
}

function LocationTiles({ locations }: { locations: SupplierLocation[] }) {
  if (!locations.length) return null;
  return (
    <div className="mt-2 space-y-1.5 border-t border-neutral-100 pt-2">
      {locations.map((l) => (
        <div key={l.id} className="rounded-lg bg-neutral-50 px-2.5 py-1.5 text-sm">
          <div className="font-medium text-neutral-800">{l.label}</div>
          {l.address ? (
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(l.address)}`}
              target="_blank" rel="noopener noreferrer"
              className="block text-[12px] text-neutral-500 hover:text-brand-700 hover:underline"
            >
              {l.address}
            </a>
          ) : null}
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px]">
            {l.phone ? (
              <span className="flex items-center gap-1">
                <a href={telHref(l.phone)} className="font-medium text-brand-700 hover:underline">📞 {l.phone}</a>
                <CopyBtn text={l.phone.replace(/[^0-9+]/g, "")} />
              </span>
            ) : null}
            {l.website ? (
              <a href={l.website.startsWith("http") ? l.website : `https://${l.website}`} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">website ↗</a>
            ) : null}
            {l.hours ? <span className="text-neutral-400">{l.hours}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  plumbing_supply: "Plumbing supply",
  big_box: "Big box",
  specialty: "Specialty",
  other: "Other",
};
const CATEGORY_TONE: Record<string, string> = {
  plumbing_supply: "bg-brand-50 text-brand-800 ring-brand-200",
  big_box: "bg-gold-300/40 text-navy-900 ring-gold-500/40",
  specialty: "bg-navy-800/10 text-navy-900 ring-navy-800/30",
  other: "bg-neutral-100 text-neutral-700 ring-neutral-300",
};

function buildMailto(d: Distributor, needs: NeedLine[], who: string): string {
  const subject = "Parts order / quote request — Tulsa Plumbing & Remodeling";
  const acct = d.accountNumber ? ` (account ${d.accountNumber})` : "";
  const items = needs.length > 0 ? needs.map((n) => `- ${n.qty ? `${n.qty}x ` : ""}${n.item}`).join("\n") : "- ";
  const body = [
    `Hi ${d.name},`,
    "",
    `This is Tulsa Plumbing and Remodeling${acct}. We'd like to order / get a quote on:`,
    "",
    items,
    "",
    "Please confirm availability, pricing, and pickup/delivery options.",
    "",
    "Thanks,",
    who || "Tulsa Plumbing and Remodeling",
    "Tulsa Plumbing and Remodeling · 918-800-4426",
  ].join("\n");
  return `mailto:${d.orderEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function DistributorDirectory({
  distributors,
  openNeeds,
  canEdit,
  signedInName,
  locationsByDist = {},
}: {
  distributors: Distributor[];
  openNeeds: NeedLine[];
  canEdit: boolean;
  signedInName: string;
  locationsByDist?: Record<string, SupplierLocation[]>;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-neutral-600">
          {distributors.length} supplier{distributors.length === 1 ? "" : "s"}. Tap a phone to call; enabled vendors get an order/quote email button.
        </p>
        {canEdit ? (
          <button
            type="button"
            onClick={() => { setAdding((v) => !v); setEditingId(null); }}
            className="rounded-md bg-navy-800 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-navy-900"
          >
            {adding ? "Cancel" : "+ Add supplier"}
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="mb-4">
          <DistributorForm onClose={() => setAdding(false)} />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {distributors.map((d) =>
          editingId === d.id ? (
            <DistributorForm key={d.id} existing={d} onClose={() => setEditingId(null)} />
          ) : (
            <DistributorCard
              key={d.id}
              d={d}
              openNeeds={openNeeds}
              who={signedInName}
              canEdit={canEdit}
              onEdit={() => { setEditingId(d.id); setAdding(false); }}
              locations={locationsByDist[d.id] ?? locationsByDist[`name:${d.name}`] ?? []}
            />
          )
        )}
      </div>
    </div>
  );
}

function DistributorCard({
  d, openNeeds, who, canEdit, onEdit, locations,
}: {
  d: Distributor; openNeeds: NeedLine[]; who: string; canEdit: boolean; onEdit: () => void; locations: SupplierLocation[];
}) {
  const tone = CATEGORY_TONE[d.category ?? "other"] ?? CATEGORY_TONE.other;
  return (
    <div className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-neutral-900">{d.name}</span>
          {d.category ? (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset ${tone}`}>
              {CATEGORY_LABEL[d.category] ?? d.category}
            </span>
          ) : null}
        </div>
        {canEdit ? (
          <button type="button" onClick={onEdit} className="shrink-0 text-xs text-neutral-400 hover:text-neutral-700">
            Edit
          </button>
        ) : null}
      </div>

      <div className="space-y-0.5 text-sm text-neutral-600">
        {d.contactName ? <div>{d.contactName}</div> : null}
        {d.phone ? (
          <div><a href={`tel:${d.phone.replace(/[^0-9+]/g, "")}`} className="text-brand-700 hover:underline">{d.phone}</a></div>
        ) : null}
        {d.address ? <div className="text-neutral-500">{d.address}</div> : null}
        {d.accountNumber ? <div className="text-xs text-neutral-500">Acct #{d.accountNumber}</div> : null}
        {d.website ? (
          <div><a href={d.website.startsWith("http") ? d.website : `https://${d.website}`} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 hover:underline">{d.website}</a></div>
        ) : null}
        {d.notes ? <div className="mt-1 whitespace-pre-line text-xs text-neutral-500">{d.notes}</div> : null}
      </div>

      <LocationTiles locations={locations} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {d.canEmailOrder && d.orderEmail ? (
          <a
            href={buildMailto(d, openNeeds, who)}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-700"
          >
            📧 Email order / quote
          </a>
        ) : (
          <span className="text-xs italic text-neutral-400">
            {canEdit ? "Add an order email + enable to send orders here." : "No order email on file."}
          </span>
        )}
      </div>
    </div>
  );
}

function DistributorForm({ existing, onClose }: { existing?: Distributor; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<DistributorInput>({
    id: existing?.id,
    name: existing?.name ?? "",
    category: existing?.category ?? "plumbing_supply",
    contactName: existing?.contactName ?? "",
    phone: existing?.phone ?? "",
    email: existing?.email ?? "",
    orderEmail: existing?.orderEmail ?? "",
    accountNumber: existing?.accountNumber ?? "",
    address: existing?.address ?? "",
    website: existing?.website ?? "",
    notes: existing?.notes ?? "",
    canEmailOrder: existing?.canEmailOrder ?? false,
    sortOrder: existing?.sortOrder ?? 100,
  });

  const set = (k: keyof DistributorInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  function save() {
    setErr(null);
    start(async () => {
      const res = await upsertDistributor(f);
      if (res.ok) { onClose(); router.refresh(); }
      else setErr(res.error ?? "Couldn't save.");
    });
  }
  function remove() {
    if (!existing) return;
    start(async () => {
      const res = await deleteDistributor(existing.id);
      if (res.ok) { onClose(); router.refresh(); }
      else setErr(res.error ?? "Couldn't remove.");
    });
  }

  const input = "w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-navy-700 focus:outline-none";

  return (
    <div className="rounded-2xl border border-navy-800/30 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-neutral-500">Name
          <input className={input} value={f.name} onChange={set("name")} placeholder="Locke Supply" />
        </label>
        <label className="text-xs text-neutral-500">Category
          <select className={input} value={f.category ?? "plumbing_supply"} onChange={set("category")}>
            <option value="plumbing_supply">Plumbing supply</option>
            <option value="big_box">Big box</option>
            <option value="specialty">Specialty</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="text-xs text-neutral-500">Contact name
          <input className={input} value={f.contactName ?? ""} onChange={set("contactName")} />
        </label>
        <label className="text-xs text-neutral-500">Phone
          <input className={input} value={f.phone ?? ""} onChange={set("phone")} placeholder="918-555-1234" />
        </label>
        <label className="text-xs text-neutral-500">General email
          <input className={input} value={f.email ?? ""} onChange={set("email")} />
        </label>
        <label className="text-xs text-neutral-500">Order / quote email
          <input className={input} value={f.orderEmail ?? ""} onChange={set("orderEmail")} placeholder="orders@vendor.com" />
        </label>
        <label className="text-xs text-neutral-500">Account #
          <input className={input} value={f.accountNumber ?? ""} onChange={set("accountNumber")} />
        </label>
        <label className="text-xs text-neutral-500">Website
          <input className={input} value={f.website ?? ""} onChange={set("website")} />
        </label>
        <label className="text-xs text-neutral-500 sm:col-span-2">Address
          <input className={input} value={f.address ?? ""} onChange={set("address")} />
        </label>
        <label className="text-xs text-neutral-500 sm:col-span-2">Notes
          <textarea className={input} rows={2} value={f.notes ?? ""} onChange={set("notes")} />
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={!!f.canEmailOrder}
          onChange={(e) => setF((p) => ({ ...p, canEmailOrder: e.target.checked }))}
        />
        Enable the “Email order / quote” button (needs an order email)
      </label>

      {err ? <div className="mt-2 text-xs text-red-600">{err}</div> : null}

      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={save} disabled={pending} className="rounded-md bg-navy-800 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-navy-900 disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onClose} disabled={pending} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50">
          Cancel
        </button>
        {existing ? (
          <button type="button" onClick={remove} disabled={pending} className="ml-auto text-xs text-red-500 hover:text-red-700 disabled:opacity-50">
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}
