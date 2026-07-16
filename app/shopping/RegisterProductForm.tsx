"use client";

// 📋 Register a product (SPEC_2026-07-16): snap the plate → vision extracts
// brand/model/serial/energy → AppGuide job pick auto-fills dates + customer →
// save writes product_registrations + auto-notes BOTH profiles. The tech
// types, ideally, nothing except corrections. Mirrors the /receipt patterns
// (upload-first storage, AppGuide, success card).

import { useState, useTransition } from "react";
import { browserClient } from "@/lib/supabase-browser";
import { AppGuide } from "@/components/AppGuide";
import {
  createRegistrationUpload, extractProductPlate, tetherJob, saveRegistration,
  type JobTether, type PlateExtract,
} from "@/lib/registration-actions";

const ENERGY_OPTIONS = ["", "NG", "LP", "Oil", "Electric"] as const;

export function RegisterProductForm({ techShortName, techNames = [] }: { techShortName: string; techNames?: string[] }) {
  // B4: the same capture flow also logs COMPANY TOOLS (the Milwaukee saw died
  // unregistered because registering was one more thing — "later at a desk"
  // is the entire fix). Tool mode drops the customer/job tether + dates and
  // adds assigned-to + One-Key.
  const [kind, setKind] = useState<"customer_product" | "company_tool">("customer_product");
  const isTool = kind === "company_tool";
  const [assignedTo, setAssignedTo] = useState("");
  const [oneKey, setOneKey] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [extract, setExtract] = useState<PlateExtract | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [jobQuery, setJobQuery] = useState("");
  const [tether, setTether] = useState<JobTether | null>(null);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [energy, setEnergy] = useState("");
  const [installDate, setInstallDate] = useState("");
  const [startupDate, setStartupDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ id: number; noted: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onPhoto(f: File | null) {
    setPhoto(f);
    setPhotoPath(null);
    setExtract(null);
    if (!f) { setPhotoPreview(null); return; }
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(f);
    // Upload-first, then extract — the tech watches fields fill themselves.
    setExtracting(true);
    setError(null);
    try {
      const slot = await createRegistrationUpload({ filename: f.name });
      if (!slot.ok) { setError(slot.error); return; }
      const { error: upErr } = await browserClient().storage
        .from("job-photos")
        .uploadToSignedUrl(slot.path, slot.token, f, { contentType: f.type || "image/jpeg" });
      if (upErr) { setError(`Upload failed: ${upErr.message}`); return; }
      setPhotoPath(slot.path);
      const ex = await extractProductPlate({ path: slot.path });
      if (ex.ok) {
        setExtract(ex.extracted);
        if (ex.extracted.brand) setBrand(ex.extracted.brand);
        if (ex.extracted.model) setModel(ex.extracted.model);
        if (ex.extracted.serial_number) setSerial(ex.extracted.serial_number);
        if (ex.extracted.energy_type) setEnergy(ex.extracted.energy_type);
      } else {
        setError(ex.error);
      }
    } finally {
      setExtracting(false);
    }
  }

  function applyTether(t: JobTether) {
    setTether(t);
    if (t.install_date) {
      setInstallDate(t.install_date);
      if (!startupDate) setStartupDate(t.install_date);
    }
  }

  async function pickJob(q: string) {
    setJobQuery(q);
    const r = await tetherJob({ invoiceOrJobId: q });
    if (r.ok) { setError(null); applyTether(r.tether); }
    else { setTether(null); setError(r.error); }
  }

  function reset() {
    setPhoto(null); setPhotoPreview(null); setPhotoPath(null); setExtract(null);
    setJobQuery(""); setTether(null); setBrand(""); setModel(""); setSerial("");
    setEnergy(""); setInstallDate(""); setStartupDate(""); setNotes("");
    setAssignedTo(""); setOneKey(false);
    setError(null); setSuccess(null);
  }

  if (success) {
    return (
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5">
        <h3 className="text-lg font-bold text-emerald-900">
          {isTool ? "✅ Tool logged — registration pending" : "✅ Product logged — registration pending"}
        </h3>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-emerald-900 sm:max-w-md">
          <dt className="font-medium">{isTool ? "Tool" : "Product"}</dt><dd>{brand} {model}</dd>
          <dt className="font-medium">Serial</dt><dd>{serial || "—"}</dd>
          {isTool ? (
            <>
              <dt className="font-medium">Assigned to</dt><dd>{assignedTo || "shop"}</dd>
              <dt className="font-medium">One-Key</dt><dd>{oneKey ? "registered ✓" : "not yet — office handles it"}</dd>
            </>
          ) : (
            <>
              <dt className="font-medium">Job</dt><dd>{tether ? `${tether.customer_name ?? tether.hcp_job_id}` : "no job tether"}</dd>
              <dt className="font-medium">Noted on profiles</dt>
              <dd>{tether ? (success.noted ? "customer + job ✓" : "⚠️ note failed — tell the office") : "n/a (no job)"}</dd>
            </>
          )}
        </dl>
        <p className="mt-2 text-xs text-emerald-800">The office registers it with the manufacturer in the weekly batch below.</p>
        <button type="button" onClick={reset}
          className="mt-3 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Log another
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Kind toggle: customer product (warranty for them) vs company tool
          (warranty + One-Key for us). */}
      <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 text-sm sm:max-w-sm">
        {([["customer_product", "🏠 Customer product"], ["company_tool", "🧰 Company tool"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${kind === k ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}>
            {label}
          </button>
        ))}
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-900">{error}</div> : null}

      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700">Plate / registration card photo *</label>
        <input
          type="file" accept="image/*" capture="environment"
          onChange={(e) => onPhoto(e.target.files?.[0] ?? null)}
          className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
        />
        {extracting ? <p className="mt-1 text-xs text-brand-700">Reading the plate…</p> : null}
        {extract && !extracting ? (
          <p className="mt-1 text-xs text-neutral-500">
            Read from the photo ({extract.confidence ?? "?"} confidence){extract.notes ? ` — ${extract.notes}` : ""}. Correct anything wrong below.
          </p>
        ) : null}
        {photoPreview ? <img src={photoPreview} alt="plate preview" className="mt-2 max-h-48 rounded-xl border border-neutral-200 object-contain" /> : null}
      </div>

      {!isTool ? (
        <>
          <AppGuide
            label="Which job was this installed on?"
            placeholder='"trotzuk" / "1342 east 25th" / "current" / leave empty for today'
            actions={["use"]}
            compact
            showAmbient={false}
            onSelect={(cand) => { if (cand.invoice_number) void pickJob(cand.invoice_number); }}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="text" value={jobQuery} inputMode="numeric"
              onChange={(e) => setJobQuery(e.target.value)}
              onBlur={() => { if (jobQuery.trim()) void pickJob(jobQuery); }}
              placeholder="or type invoice / job #"
              className="w-44 rounded-md border border-neutral-300 px-3 py-2"
            />
            {tether ? (
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                ⛓ {tether.customer_name ?? tether.hcp_job_id}{tether.address ? ` · ${tether.address}` : ""}
              </span>
            ) : (
              <span className="text-xs text-neutral-500">no job tether — dates/customer won&apos;t auto-fill</span>
            )}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-600">Assigned to</span>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2">
              <option value="">— shop / shared —</option>
              {techNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm text-neutral-700">
            <input type="checkbox" checked={oneKey} onChange={(e) => setOneKey(e.target.checked)} className="h-4 w-4" />
            Already in One-Key
          </label>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-600">Brand</span>
          <input value={brand} onChange={(e) => setBrand(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-600">Model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-600">Serial #</span>
          <input value={serial} onChange={(e) => setSerial(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2" />
        </label>
        {!isTool ? (
          <>
            <label className="block text-sm">
              <span className="mb-1 block text-neutral-600">Energy</span>
              <select value={energy} onChange={(e) => setEnergy(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2">
                {ENERGY_OPTIONS.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-neutral-600">Install date</span>
              <input type="date" value={installDate} onChange={(e) => setInstallDate(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-neutral-600">Start-up date</span>
              <input type="date" value={startupDate} onChange={(e) => setStartupDate(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2" />
            </label>
          </>
        ) : null}
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-neutral-600">Notes (optional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="anything the office should know"
          className="w-full rounded-md border border-neutral-300 px-3 py-2" />
      </label>

      <button
        type="button"
        disabled={isPending || extracting || !photoPath}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const r = await saveRegistration({
              photoPath,
              kind,
              hcpJobId: isTool ? null : tether?.hcp_job_id ?? null,
              hcpCustomerId: isTool ? null : tether?.hcp_customer_id ?? null,
              brand, model, serialNumber: serial, energyType: isTool ? null : energy || null,
              installDate: isTool ? null : installDate || null, startupDate: isTool ? null : startupDate || null,
              assignedTo: isTool ? assignedTo || null : null,
              oneKeyRegistered: isTool ? oneKey : null,
              notes: notes || null, extracted: extract,
            });
            if (r.ok) setSuccess({ id: r.id, noted: r.noted });
            else setError(r.error);
          });
        }}
        className="rounded-md bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
      >
        {isPending ? "Saving…" : `📋 Log ${isTool ? "tool" : "product"}${techShortName ? ` as ${techShortName}` : ""}`}
      </button>
    </div>
  );
}
