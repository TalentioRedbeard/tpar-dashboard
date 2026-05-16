"use client";

import { useState, useTransition } from "react";
import { uploadReceipt } from "./actions";
import { AppGuide } from "../../components/AppGuide";

export function ReceiptForm({ techShortName, canWrite }: { techShortName: string; canWrite: boolean }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ receipt_id: number; photo_url: string; amount: string; vendor: string; invoice: string; notes: string; localPreview: string | null } | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!canWrite) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">
        Read-only — receipts can be logged by Danny or a tech.
      </div>
    );
  }

  if (success) {
    // Prefer the local data-URL preview for instant render (no network roundtrip);
    // fall back to the public Supabase URL. Both should produce the same image.
    const inlineSrc = success.localPreview ?? success.photo_url;
    const jobLabel = success.invoice ? `Job #${success.invoice}` : "Overhead";
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6">
          <div className="flex items-start gap-3">
            <span aria-hidden className="text-3xl leading-none">✅</span>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-emerald-900">Receipt uploaded!</h2>
              <p className="mt-1 text-sm text-emerald-800">
                Saved as receipt #{success.receipt_id} · submitted by {techShortName}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-emerald-900 sm:max-w-md">
                <dt className="font-medium">Amount</dt>
                <dd>{success.amount ? `$${success.amount}` : <span className="text-emerald-700/70 italic">(not entered)</span>}</dd>
                <dt className="font-medium">Vendor</dt>
                <dd>{success.vendor || <span className="text-emerald-700/70 italic">(not entered)</span>}</dd>
                <dt className="font-medium">Charged to</dt>
                <dd>{jobLabel}</dd>
                {success.notes ? (<><dt className="font-medium">Notes</dt><dd>{success.notes}</dd></>) : null}
              </dl>
            </div>
          </div>

          {inlineSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={inlineSrc}
              alt={`Receipt #${success.receipt_id}`}
              className="mt-4 max-h-96 w-full rounded-xl border-2 border-emerald-200 bg-white object-contain"
            />
          ) : null}

          <a
            href={success.photo_url}
            target="_blank"
            rel="noopener"
            className="mt-3 inline-block text-xs text-emerald-700 hover:underline"
          >
            Open full-size photo →
          </a>
        </div>

        <div className="flex flex-wrap gap-2">
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
            href="/me"
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            ← Back to my day
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* AppGuide — picks the job for this receipt and fills the invoice field.
       *  Lives above the form (under the page banner per Danny's 2026-05-16 spec). */}
      <AppGuide
        label="Which job is this receipt for?"
        placeholder='"trotzuk" / "1342 east 25th" / "current" / leave empty for today'
        actions={["use"]}
        compact
        showAmbient={false}
        onSelect={(cand) => {
          if (cand.invoice_number) {
            setInvoiceNumber(cand.invoice_number);
            if (typeof document !== "undefined") {
              const el = document.querySelector('input[type="file"]') as HTMLElement | null;
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }
        }}
      />

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
          // Snapshot the form values + local preview BEFORE the request so the
          // success card can show them back to the tech (instant visual proof).
          const snapshot = {
            amount: amount.trim(),
            vendor: vendor.trim(),
            invoice: invoiceNumber.trim(),
            notes: notes.trim(),
            localPreview: photoPreview,
          };
          startTransition(async () => {
            const res = await uploadReceipt(fd);
            if (res.ok) {
              setSuccess({
                receipt_id: res.receipt_id,
                photo_url: res.photo_url,
                ...snapshot,
              });
            } else {
              setError(res.error);
            }
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
    </div>
  );
}
