"use client";

import { useState, useTransition } from "react";
import { createReceiptUpload, finalizeReceipt, probeReceiptExtraction } from "./actions";
import { browserClient } from "@/lib/supabase-browser";
import { AppGuide } from "../../components/AppGuide";

// Non-job PO categories (SPEC_2026-07-16): the counter PO is sometimes a word.
const CATEGORY_CHIPS = [
  { token: "gas", label: "Gas", icon: "⛽" },
  { token: "tools", label: "Tools", icon: "🔧" },
  { token: "office", label: "Office", icon: "🏢" },
  { token: "dining", label: "Dining", icon: "🍽" },
  { token: "other", label: "Other", icon: "❓" },
] as const;

// B1 (2026-07-16): gas receipts tether to a vehicle + odometer.
export type ReceiptVehicle = {
  id: string;
  label: string;
  driver: string | null;
  odometer: number | null;      // latest Bouncie reading, rounded miles
  odometerAt: string | null;    // ISO of that reading
};

export function ReceiptForm({
  techShortName,
  canWrite,
  vehicles = [],
  defaultVehicleId = null,
}: {
  techShortName: string;
  canWrite: boolean;
  vehicles?: ReceiptVehicle[];
  defaultVehicleId?: string | null;
}) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  // B5 OCR-at-snap: the photo uploads the moment it's picked (upload-first
  // still — browser → Storage direct) so the vision probe can prefill
  // amount/vendor while the tech is still standing at the counter.
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [prefilled, setPrefilled] = useState<string[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [category, setCategory] = useState<string | null>(null); // overhead chip (mutually exclusive with job #)
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  // Gas-only vehicle + odometer. Odometer prefills from the picked vehicle's
  // latest Bouncie reading and re-prefills on vehicle change UNLESS the tech
  // typed their own number (odometerEdited).
  const [vehicleId, setVehicleId] = useState<string>("");
  const [odometer, setOdometer] = useState("");
  const [odometerEdited, setOdometerEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ receipt_id: number; photo_url: string; amount: string; vendor: string; invoice: string; category: string | null; notes: string; localPreview: string | null } | null>(null);
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
    const catChip = success.category ? CATEGORY_CHIPS.find((c) => c.token === success.category) : null;
    const jobLabel = success.invoice
      ? `Job #${success.invoice}`
      : catChip
        ? `Overhead — ${catChip.icon} ${catChip.label}`
        : "(unassigned — office will sort it)";
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
              setInvoiceNumber(""); setCategory(null); setAmount(""); setVendor(""); setNotes("");
              setVehicleId(""); setOdometer(""); setOdometerEdited(false);
              setUploadedPath(null); setPrefilled([]);
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
            setCategory(null);
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
          const file = photo;
          // Snapshot the form values + local preview BEFORE the request so the
          // success card can show them back to the tech (instant visual proof).
          const snapshot = {
            amount: amount.trim(),
            vendor: vendor.trim(),
            invoice: invoiceNumber.trim(),
            category,
            notes: notes.trim(),
            localPreview: photoPreview,
          };
          startTransition(async () => {
            try {
              // Upload-first: the snap handler usually uploaded already (B5) —
              // reuse that path; otherwise PUT straight to Storage now (no
              // Vercel body cap), then record the receipts_master row.
              let path = uploadedPath;
              if (!path) {
                const slot = await createReceiptUpload({ filename: file.name });
                if (!slot.ok) { setError(slot.error); return; }
                const supa = browserClient();
                const { error: upErr } = await supa.storage
                  .from("job-photos")
                  .uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type || "application/octet-stream" });
                if (upErr) { setError(`Upload failed: ${upErr.message}. Your receipt wasn't saved — try again.`); return; }
                path = slot.path;
              }
              const res = await finalizeReceipt({
                path,
                invoice_number: invoiceNumber,
                amount,
                vendor,
                notes,
                category,
                vehicle_id: category === "gas" ? vehicleId || null : null,
                odometer_miles: category === "gas" ? odometer || null : null,
              });
              if (res.ok) setSuccess({ receipt_id: res.receipt_id, photo_url: res.photo_url, ...snapshot });
              else setError(res.error);
            } catch (err) {
              setError(`Upload failed: ${err instanceof Error ? err.message : String(err)}. Your receipt wasn't saved — try again.`);
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
            setUploadedPath(null);
            setPrefilled([]);
            if (!f) { setPhotoPreview(null); return; }
            const reader = new FileReader();
            reader.onload = () => setPhotoPreview(reader.result as string);
            reader.readAsDataURL(f);
            // B5: upload NOW (browser → Storage direct), then probe the vision
            // lane and prefill still-empty fields. Any failure falls back to
            // the plain manual flow silently — never block the tech.
            void (async () => {
              setReading(true);
              try {
                const slot = await createReceiptUpload({ filename: f.name });
                if (!slot.ok) return;
                const supa = browserClient();
                const { error: upErr } = await supa.storage
                  .from("job-photos")
                  .uploadToSignedUrl(slot.path, slot.token, f, { contentType: f.type || "application/octet-stream" });
                if (upErr) return;
                setUploadedPath(slot.path);
                const probe = await probeReceiptExtraction({ path: slot.path });
                if (!probe.ok || !probe.probe.is_receipt) return;
                // Only into EMPTY fields — never clobber what the tech typed
                // during the read. Set-based flag stays idempotent under
                // StrictMode's double-invoked updaters; the timeout reads it
                // after React flushes them.
                const filled = new Set<string>();
                setAmount((cur) => {
                  if (cur.trim() || probe.probe.total == null) return cur;
                  filled.add("amount");
                  return probe.probe.total.toFixed(2);
                });
                setVendor((cur) => {
                  if (cur.trim() || !probe.probe.vendor) return cur;
                  filled.add("vendor");
                  return probe.probe.vendor;
                });
                setTimeout(() => { if (filled.size) setPrefilled([...filled]); }, 0);
              } finally {
                setReading(false);
              }
            })();
          }}
          className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
        />
        {reading ? <p className="mt-1 text-xs text-brand-700">📖 Reading the receipt…</p> : null}
        {prefilled.length > 0 && !reading ? (
          <p className="mt-1 text-xs text-neutral-500">
            Auto-read from the photo ({prefilled.join(" + ")}) — check it before you submit.
          </p>
        ) : null}
        {photoPreview ? (
          <img src={photoPreview} alt="receipt preview" className="mt-3 max-h-64 rounded-2xl border border-neutral-200 object-contain" />
        ) : null}
      </section>

      {/* Charge to — a job # OR one overhead chip, mutually exclusive (SPEC_2026-07-16).
       *  Numeric keyboard stays: this field is ONLY ever a job/invoice number now. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">Charge to — invoice / job # (optional)</label>
          <input
            type="text"
            value={invoiceNumber}
            onChange={(e) => {
              setInvoiceNumber(e.target.value);
              if (e.target.value.trim()) setCategory(null);
            }}
            placeholder="e.g., 27691201"
            inputMode="numeric"
            className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-neutral-500">or overhead:</span>
            {CATEGORY_CHIPS.map((c) => {
              const active = category === c.token;
              return (
                <button
                  key={c.token}
                  type="button"
                  onClick={() => {
                    if (active) {
                      setCategory(null);
                      if (c.token === "gas") { setVehicleId(""); setOdometer(""); setOdometerEdited(false); }
                      return;
                    }
                    setCategory(c.token);
                    setInvoiceNumber("");
                    if (c.token === "gas") {
                      // Default to the tech's own van; prefill its latest odometer.
                      const vid = vehicleId || defaultVehicleId || "";
                      setVehicleId(vid);
                      const v = vehicles.find((x) => x.id === vid);
                      if (!odometerEdited) setOdometer(v?.odometer != null ? String(v.odometer) : "");
                    } else {
                      setVehicleId(""); setOdometer(""); setOdometerEdited(false);
                    }
                  }}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? "bg-brand-700 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}
                >
                  {c.icon} {c.label}
                </button>
              );
            })}
          </div>
          {category === "other" ? (
            <p className="mt-1 text-xs text-amber-700">A word in Notes helps the office sort “Other”.</p>
          ) : null}
          {category === "gas" && vehicles.length > 0 ? (
            (() => {
              const v = vehicles.find((x) => x.id === vehicleId) ?? null;
              return (
                <div className="mt-3 space-y-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                  <label className="block text-xs font-medium text-neutral-700">
                    Which vehicle?
                    <select
                      value={vehicleId}
                      onChange={(e) => {
                        setVehicleId(e.target.value);
                        const nv = vehicles.find((x) => x.id === e.target.value);
                        if (!odometerEdited) setOdometer(nv?.odometer != null ? String(nv.odometer) : "");
                      }}
                      className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <option value="">— pick one —</option>
                      {vehicles.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}{x.driver ? ` · ${x.driver}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-neutral-700">
                    Odometer (miles, optional)
                    <input
                      type="text"
                      inputMode="numeric"
                      value={odometer}
                      onChange={(e) => { setOdometer(e.target.value); setOdometerEdited(true); }}
                      placeholder="e.g., 41557"
                      className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </label>
                  {v?.odometer != null && !odometerEdited ? (
                    <p className="text-[11px] text-neutral-500">
                      Pre-filled from Bouncie{v.odometerAt ? ` (as of ${new Date(v.odometerAt).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })})` : ""} — fix it if it&apos;s off.
                    </p>
                  ) : null}
                </div>
              );
            })()
          ) : null}
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
