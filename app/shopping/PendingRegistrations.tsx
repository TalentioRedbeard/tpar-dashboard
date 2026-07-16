"use client";

// Pending registrations — the leadership batch (SPEC_2026-07-16). Grouped by
// brand, oldest first; each row expands to the COMPLETE manufacturer payload
// in the Bosch card's field order, every field copy-able. v1 is deliberately
// assemble-and-copy, never auto-submit (every manufacturer form differs and
// most are CAPTCHA'd).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  markRegistered, markNotNeeded, setOneKeyRegistered,
  type PendingRegistration, type Manufacturer, type TparCompany,
} from "@/lib/registration-actions";

function CopyField({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-neutral-50 px-2.5 py-1.5 text-sm">
      <div className="min-w-0">
        <span className="mr-2 text-xs text-neutral-500">{label}</span>
        <span className="font-medium text-navy-900">{value || "—"}</span>
      </div>
      <button
        type="button"
        disabled={!value}
        onClick={async () => {
          await navigator.clipboard.writeText(value ?? "");
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="shrink-0 rounded bg-neutral-200 px-2 py-0.5 text-xs font-medium text-navy-900 hover:bg-brand-100 disabled:opacity-40"
      >
        {copied ? "✓" : "copy"}
      </button>
    </div>
  );
}

export function PendingRegistrations({
  rows, registry, company,
}: {
  rows: PendingRegistration[];
  registry: Manufacturer[];
  company: TparCompany;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<number | null>(null);
  const [confRef, setConfRef] = useState("");
  const [why, setWhy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byBrand = new Map<string, PendingRegistration[]>();
  for (const r of rows) {
    const b = r.brand?.trim() || "Unknown brand";
    if (!byBrand.has(b)) byBrand.set(b, []);
    byBrand.get(b)!.push(r);
  }

  const ageDays = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setErr(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) { setErr(r.error ?? "Failed."); return; }
      setOpenId(null); setConfRef(""); setWhy("");
      router.refresh();
    });
  };

  // The manufacturer's field order (the Bosch card is the template). Company
  // tools (B4) drop the customer/date fields and carry owner/One-Key instead —
  // the registered owner IS the company.
  const payloadFields = (r: PendingRegistration): Array<[string, string | null]> =>
    r.kind === "company_tool"
      ? [
          ["Model", r.model],
          ["Serial number", r.serial_number],
          ["Assigned to", r.assigned_to ?? "shop / shared"],
          ["Logged by", r.installed_by],
          ["One-Key", r.one_key_registered ? "registered" : "NOT registered"],
          ["Company name", company.name],
          ["Company address", company.address],
          ["City", company.city],
          ["State", company.state],
          ["ZIP", company.zip],
          ["Company phone", company.phone],
        ]
      : [
          ["Install date", r.install_date],
          ["Start-up date", r.startup_date],
          ["Model", r.model],
          ["Serial number", r.serial_number],
          ["Energy type", r.energy_type],
          ["Installer name", r.installed_by],
          ["Customer name", r.customer_name],
          ["Customer address", r.job_address],
          ["Company name", company.name],
          ["Company address", company.address],
          ["City", company.city],
          ["State", company.state],
          ["ZIP", company.zip],
          ["Company phone", company.phone],
        ];

  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">Nothing pending — every logged product is registered or closed.</p>;
  }

  return (
    <div className="space-y-4">
      {err ? <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-900">{err}</div> : null}
      {[...byBrand.entries()].map(([b, group]) => {
        const mfr = registry.find((m) => m.brand.toLowerCase() === b.toLowerCase()) ?? null;
        return (
          <div key={b} className="rounded-xl border border-neutral-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-2.5">
              <span className="font-semibold text-navy-900">{b} <span className="font-normal text-neutral-500">({group.length})</span></span>
              {mfr ? (
                <span className="text-xs text-neutral-600">
                  <a href={mfr.url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{mfr.url.replace(/^https?:\/\/(www\.)?/, "")}</a>
                  {" · "}{mfr.phone}
                </span>
              ) : (
                <span className="text-xs text-amber-700">registration URL unknown — add to the registry</span>
              )}
            </div>
            <ul className="divide-y divide-neutral-100">
              {group.map((r) => {
                const open = openId === r.id;
                return (
                  <li key={r.id} className="px-4 py-2.5 text-sm">
                    <button type="button" onClick={() => setOpenId(open ? null : r.id)}
                      className="flex w-full items-center justify-between gap-3 text-left">
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-navy-900">{r.model ?? "model?"}</span>
                        {r.kind === "company_tool" ? (
                          <>
                            {" "}<span className="rounded bg-brand-100 px-1.5 text-xs font-medium text-brand-800">🧰 tool · {r.assigned_to ?? "shop"}</span>
                            {r.one_key_registered === false ? <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-800">One-Key ✗</span> : null}
                          </>
                        ) : (
                          <>{" · "}{r.customer_name ?? (r.hcp_job_id ? r.hcp_job_id : <span className="rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-800">no job tether</span>)}</>
                        )}
                        {r.installed_by ? ` · ${r.installed_by}` : ""}
                      </span>
                      <span className={`shrink-0 text-xs ${ageDays(r.created_at) > 14 ? "font-semibold text-red-700" : "text-neutral-500"}`}>
                        {ageDays(r.created_at)}d
                      </span>
                    </button>
                    {open ? (
                      <div className="mt-2 space-y-2">
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          {payloadFields(r).map(([label, value]) => <CopyField key={label} label={label} value={value} />)}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button"
                            onClick={async () => {
                              const text = payloadFields(r).map(([l, v]) => `${l}: ${v ?? ""}`).join("\n");
                              await navigator.clipboard.writeText(text);
                            }}
                            className="rounded-md bg-neutral-200 px-3 py-1.5 text-xs font-semibold text-navy-900 hover:bg-neutral-300">
                            Copy all
                          </button>
                          {r.photo_url ? (
                            <a href={r.photo_url} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline">plate photo →</a>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 p-2.5">
                          <input value={confRef} onChange={(e) => setConfRef(e.target.value)}
                            placeholder="confirmation # (optional)"
                            className="w-48 rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs" />
                          <button type="button" disabled={pending}
                            onClick={() => act(() => markRegistered({ id: r.id, confirmationRef: confRef }))}
                            className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                            ✓ Mark registered
                          </button>
                          {r.kind === "company_tool" && !r.one_key_registered ? (
                            // One-Key ≠ warranty registration — separate verb by design.
                            <button type="button" disabled={pending}
                              onClick={() => act(() => setOneKeyRegistered({ id: r.id, value: true }))}
                              className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
                              🔑 One-Key done
                            </button>
                          ) : null}
                          <input value={why} onChange={(e) => setWhy(e.target.value)}
                            placeholder="why not needed?"
                            className="w-40 rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs" />
                          <button type="button" disabled={pending}
                            onClick={() => act(() => markNotNeeded({ id: r.id, why }))}
                            className="rounded-md bg-neutral-200 px-3 py-1.5 text-xs font-semibold text-navy-900 hover:bg-neutral-300 disabled:opacity-50">
                            Not needed
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
