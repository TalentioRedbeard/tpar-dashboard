"use client";

// P4 cascading gallery filter (Danny 2026-06-18). Replaces the single-box GalleryChooser.
// Office: a row of typeaheads — Customer · Job # · Estimate #. Picking a customer locks it
// in as a chip and scopes the Job + Estimate fields to ONLY that customer (no global number
// hunt) plus a "view all photos" action; picking a job/estimate opens that photo grid. With
// no customer fixed, the Job field is a global invoice search. Techs get just a scoped Job
// search of their own jobs — customer-wide + estimates stay office-only (matches the
// server-side gates in gallery-actions). Selecting any target navigates to the photo grid.

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  galleryCustomerSuggest,
  galleryJobSuggest,
  galleryEstimateSuggest,
  type GalleryCustomerSuggestion,
  type GalleryJobSuggestion,
  type GalleryEstimateSuggestion,
} from "../lib/gallery-actions";

type Field = "customer" | "job" | "estimate" | null;

const firstName = (label: string) => label.split(/[\s,]/)[0] || label;

export function GalleryFilter({ isOffice }: { isOffice: boolean }) {
  const router = useRouter();
  const [active, setActive] = useState<Field>(null);
  const [customer, setCustomer] = useState<GalleryCustomerSuggestion | null>(null);

  const [custQ, setCustQ] = useState("");
  const [custOpts, setCustOpts] = useState<GalleryCustomerSuggestion[]>([]);
  const [custLoading, setCustLoading] = useState(false);

  const [jobQ, setJobQ] = useState("");
  const [jobOpts, setJobOpts] = useState<GalleryJobSuggestion[]>([]);
  const [jobLoading, setJobLoading] = useState(false);

  const [estQ, setEstQ] = useState("");
  const [estOpts, setEstOpts] = useState<GalleryEstimateSuggestion[]>([]);

  const open = (scope: string, id: string) => router.push(`/gallery?scope=${scope}&id=${encodeURIComponent(id)}`);

  // Debounced customer search (office only).
  useEffect(() => {
    if (!isOffice || customer) return;
    const q = custQ.trim();
    if (q.length < 2) { setCustOpts([]); setCustLoading(false); return; }
    setCustLoading(true);
    const t = setTimeout(async () => {
      const r = await galleryCustomerSuggest(q);
      setCustOpts(r);
      setCustLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [custQ, isOffice, customer]);

  // Debounced job search — scoped to the selected customer (empty query = their recent
  // jobs), else a global invoice search (≥2 chars).
  useEffect(() => {
    const q = jobQ.trim();
    const scoped = !!(customer && isOffice);
    if (!scoped && q.length < 2) { setJobOpts([]); setJobLoading(false); return; }
    setJobLoading(true);
    const t = setTimeout(async () => {
      const r = await galleryJobSuggest(q, customer?.id ?? null);
      setJobOpts(r);
      setJobLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [jobQ, customer, isOffice]);

  // Debounced estimate search — always scoped to a chosen customer (office only).
  useEffect(() => {
    if (!isOffice || !customer) { setEstOpts([]); return; }
    const t = setTimeout(async () => {
      const r = await galleryEstimateSuggest(customer.id, estQ.trim());
      setEstOpts(r);
    }, 250);
    return () => clearTimeout(t);
  }, [estQ, customer, isOffice]);

  function pickCustomer(c: GalleryCustomerSuggestion) {
    setCustomer(c);
    setCustQ(c.label);
    setJobQ("");
    setEstQ("");
    setActive(null);
  }
  function clearCustomer() {
    setCustomer(null);
    setCustQ("");
    setCustOpts([]);
    setJobQ("");
    setJobOpts([]);
    setEstQ("");
    setEstOpts([]);
  }

  // Blur with a small delay so an option's onMouseDown registers before the list unmounts.
  const blur = (field: Exclude<Field, null>) => () =>
    setTimeout(() => setActive((a) => (a === field ? null : a)), 150);

  const inputCls =
    "block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-neutral-50 disabled:text-neutral-400";
  const listCls =
    "absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-neutral-200 bg-white shadow-lg";

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className={`grid gap-2 ${isOffice ? "sm:grid-cols-3" : "grid-cols-1"}`}>
        {/* Customer (office) */}
        {isOffice ? (
          <div className="relative">
            <label className="mb-1 block text-xs font-medium text-neutral-500">Customer</label>
            {customer ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-brand-300 bg-brand-50 px-3 py-2">
                <span className="truncate text-sm text-neutral-900">👤 {customer.label}</span>
                <button onClick={clearCustomer} className="shrink-0 text-neutral-400 hover:text-neutral-700" aria-label="Clear customer">✕</button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={custQ}
                  onChange={(e) => setCustQ(e.target.value)}
                  onFocus={() => setActive("customer")}
                  onBlur={blur("customer")}
                  placeholder="Search customers…"
                  className={inputCls}
                />
                {active === "customer" && custQ.trim().length >= 2 ? (
                  <ul className={listCls}>
                    {custLoading && custOpts.length === 0 ? (
                      <li className="px-3 py-2 text-xs text-neutral-400">Searching…</li>
                    ) : custOpts.length === 0 ? (
                      <li className="px-3 py-2 text-xs text-neutral-400">No matches</li>
                    ) : (
                      custOpts.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); pickCustomer(c); }}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-neutral-50"
                          >
                            <span className="truncate text-sm text-neutral-900">{c.label}</span>
                            <span className="shrink-0 text-xs text-neutral-500">{c.memberCount > 1 ? `${c.memberCount} records · ` : ""}{c.photoCount > 0 ? `${c.photoCount} photo${c.photoCount === 1 ? "" : "s"}` : "—"}</span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {/* Job (always) */}
        <div className="relative">
          <label className="mb-1 block text-xs font-medium text-neutral-500">{isOffice ? "Job #" : "Your jobs"}</label>
          <input
            type="text"
            value={jobQ}
            onChange={(e) => setJobQ(e.target.value)}
            onFocus={() => setActive("job")}
            onBlur={blur("job")}
            placeholder={customer ? `Search ${firstName(customer.label)}'s jobs…` : "Job # / invoice…"}
            className={inputCls}
          />
          {active === "job" ? (
            <ul className={listCls}>
              {jobLoading && jobOpts.length === 0 ? (
                <li className="px-3 py-2 text-xs text-neutral-400">Searching…</li>
              ) : jobOpts.length === 0 ? (
                <li className="px-3 py-2 text-xs text-neutral-400">
                  {customer ? "No jobs for this customer" : jobQ.trim().length < 2 ? "Type a job # / invoice…" : "No matches"}
                </li>
              ) : (
                jobOpts.map((j) => {
                  const showCust = !customer && !!j.customerName;
                  const label = showCust ? (j.customerName as string) : `#${j.invoice ?? "?"}`;
                  const sub = showCust
                    ? `#${j.invoice ?? "?"}${j.date ? " · " + j.date : ""}`
                    : (j.date ?? "");
                  return (
                    <li key={j.hcpJobId}>
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); open("job", j.hcpJobId); }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-neutral-50"
                      >
                        <span className="truncate text-sm text-neutral-900">{label}</span>
                        <span className="shrink-0 text-xs text-neutral-500">{sub}</span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          ) : null}
        </div>

        {/* Estimate (office) */}
        {isOffice ? (
          <div className="relative">
            <label className="mb-1 block text-xs font-medium text-neutral-500">Estimate #</label>
            <input
              type="text"
              value={estQ}
              onChange={(e) => setEstQ(e.target.value)}
              onFocus={() => setActive("estimate")}
              onBlur={blur("estimate")}
              disabled={!customer}
              placeholder={customer ? "Estimate #…" : "Pick a customer first"}
              className={inputCls}
            />
            {active === "estimate" && customer ? (
              <ul className={listCls}>
                {estOpts.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-neutral-400">No estimates for this customer</li>
                ) : (
                  estOpts.map((e) => (
                    <li key={e.hcpEstimateId}>
                      <button
                        type="button"
                        onMouseDown={(ev) => { ev.preventDefault(); open("estimate", e.hcpEstimateId); }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-neutral-50"
                      >
                        <span className="truncate text-sm text-neutral-900">#{e.number ?? "?"}</span>
                        <span className="shrink-0 text-xs text-neutral-500">{[e.status, e.date].filter(Boolean).join(" · ")}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* View-all for the locked-in customer. */}
      {customer ? (
        <button
          type="button"
          onClick={() => open("customer", customer.id)}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          📷 View all {customer.photoCount > 0 ? `${customer.photoCount} ` : ""}photos for {customer.label}{customer.memberCount > 1 ? ` (${customer.memberCount} records)` : ""} →
        </button>
      ) : null}

      <p className="text-xs text-neutral-400">
        {isOffice
          ? "Pick a customer to scope the job & estimate fields to them — or search a job # directly."
          : "Search your jobs by # / invoice, then open the photos."}
      </p>
    </div>
  );
}
