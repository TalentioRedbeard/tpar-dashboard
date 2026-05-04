"use client";

import { useState, useTransition } from "react";
import { uploadReceipt } from "./actions";

export function ReceiptForm({ techShortName, canWrite }: { techShortName: string; canWrite: boolean }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ receipt_id: number; photo_url: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!canWrite) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">
        Read-only — receipts can be logged by Danny or a tech.
      </div>
    );
  }

  if (success) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-6">
          <div className="text-lg font-semibold text-emerald-900">Receipt logged.</div>
          <div className="mt-2 text-sm text-emerald-900">
            Saved as receipt #{success.receipt_id}. Submitted by {techShortName}.
          </div>
          <a href={success.photo_url} target="_blank" rel="noopener" className="mt-2 inline-block text-xs text-emerald-700 hover:underline">
            View uploaded photo →
          </a>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setSuccess(null); setPhoto(null); setPhotoPreview(null);
              setInvoiceNumber(""); setAmount(""); setVendor(""); setNotes("");
            }}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Log another
          </button>
          <a
            href="/"
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Done — back home
          </a>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!photo) { setError("Snap a photo of the receipt."); return; }
        const fd = new FormData();
        fd.set("photo", photo);
        fd.set("invoice_number", invoiceNumber);
        fd.set("amount", amount);
        fd.set("vendor", vendor);
        fd.set("notes", notes);
        startTransition(async () => {
          const res = await uploadReceipt(fd);
          if (res.ok) setSuccess({ receipt_id: res.receipt_id, photo_url: res.photo_url });
          else setError(res.error);
        });
      }}
    >
      {/* Photo capture */}
      <section>
        <label className="mb-2 block text-sm font-medium text-neutral-700">Receipt photo *</label>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          required
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setPhoto(f);
            if (f) {
              const reader = new FileReader();
              reader.onload = () => setPhotoPreview(reader.result as string);
              reader.readAsDataURL(f);
            } else {
              setPhotoPreview(null);
            }
          }}
          className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
        />
        {photoPreview ? (
          <img src={photoPreview} alt="receipt preview" className="mt-3 max-h-64 rounded-2xl border border-neutral-200 object-contain" />
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">Invoice / job # (optional)</label>
          <input
            type="text"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="e.g., 27691201"
            inputMode="numeric"
            className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">Amount (optional)</label>
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g., 142.50"
            inputMode="decimal"
            className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700">Vendor (optional)</label>
        <input
          type="text"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          placeholder="e.g., Ferguson, Home Depot"
          className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything worth flagging — overhead vs job-cost, who's it for, etc."
          className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || !photo}
          className="rounded-md bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
        >
          {isPending ? "Uploading…" : "Log receipt"}
        </button>
        {error ? <span className="text-sm text-red-700">{error}</span> : null}
      </div>
    </form>
  );
}
