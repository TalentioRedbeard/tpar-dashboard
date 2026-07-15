"use client";

// Vault client — phone-camera-friendly upload (capture attr), bucket-direct
// PUT via signed upload URL (1MB action limit law), then metadata recorded
// through the cfo_record_document doorway. Viewing mints a short-lived
// signed URL on demand; nothing in the vault ever has a public URL.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase-browser";
import { recordDocument, signedDocUrl, startVaultUpload, type VaultDoc } from "@/lib/office/actions";

const DOC_TYPES: Array<[string, string]> = [
  ["cp575", "CP-575 (EIN letter)"],
  ["license", "License / registration"],
  ["insurance_policy", "Insurance policy"],
  ["coi", "Certificate of insurance"],
  ["lease", "Lease"],
  ["sos_filing", "Secretary of State filing"],
  ["tax_return", "Tax return"],
  ["w9", "W-9"],
  ["contract", "Contract"],
  ["bank", "Bank document"],
  ["statement", "Statement"],
  ["other", "Other"],
];

const TYPE_LABEL = Object.fromEntries(DOC_TYPES);

export function VaultClient({ docs }: { docs: VaultDoc[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("license");
  const [title, setTitle] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setMsg("Pick a file or take a photo first."); return; }
    if (!title.trim()) { setMsg("Give it a title (e.g. \"BA contractor license 2025-26\")."); return; }
    setBusy(true);
    setMsg(null);
    try {
      const slot = await startVaultUpload({ filename: file.name, docType });
      if (!slot.ok) { setMsg(slot.error); return; }
      const { error } = await browserClient().storage
        .from("cfo-vault")
        .uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type || "application/octet-stream" });
      if (error) { setMsg(`Upload failed: ${error.message}`); return; }
      const rec = await recordDocument({
        title,
        docType,
        storagePath: slot.path,
        expiresOn: expiresOn || undefined,
      });
      if (!rec.ok) { setMsg(rec.error ?? "Upload stored but metadata failed — tell the builder."); return; }
      setTitle(""); setExpiresOn("");
      if (fileRef.current) fileRef.current.value = "";
      setMsg("Filed. ✓");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function view(d: VaultDoc) {
    if (!d.storage_path) return;
    startTransition(async () => {
      const r = await signedDocUrl(d.storage_path!);
      if (r.ok && r.url) window.open(r.url, "_blank", "noopener,noreferrer");
      else setMsg(r.error ?? "Could not mint a view link.");
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-navy-900">File a document</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-600">Type</span>
            <select value={docType} onChange={(e) => setDocType(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2">
              {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-600">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder={"e.g. CP-575 EIN letter"}
              className="w-full rounded-md border border-neutral-300 px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-600">Expires (optional)</span>
            <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-600">File / photo</span>
            <input ref={fileRef} type="file" accept="image/*,.pdf" capture="environment"
              className="w-full text-sm" />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={upload} disabled={busy}
            className="rounded-md bg-brand-700 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy ? "Uploading…" : "📥 File it"}
          </button>
          {msg ? <span className="text-sm text-neutral-700">{msg}</span> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-navy-900">
          In the vault <span className="font-normal text-neutral-500">({docs.length})</span>
        </h2>
        {docs.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Empty. First rescues: the CP-575, the Broken Arrow license, the Wagoner certificate,
            the lease, and whatever policy replaced the Liberty BOP.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate font-medium text-navy-900">{d.title}</div>
                  <div className="text-xs text-neutral-500">
                    {TYPE_LABEL[d.doc_type] ?? d.doc_type}
                    {d.expires_on ? ` · expires ${d.expires_on}` : ""}
                  </div>
                </div>
                {d.storage_path ? (
                  <button type="button" onClick={() => view(d)} disabled={pending}
                    className="shrink-0 rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-navy-900 hover:bg-brand-100 disabled:opacity-50">
                    View
                  </button>
                ) : (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">missing file</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
