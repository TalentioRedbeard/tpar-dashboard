"use client";

// Website twin of Slack /estimate-draft — add a priced line item to a job's HCP
// invoice. 4-question pricebook cascade (Type → Category → Work type → Item, +
// Custom) → calc (hours × crew rate + materials ×1.3) → addJobLineItem server
// action → hcp-add-job-line. Live price preview mirrors the server math.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getPricebookOptions, addJobLineItem, type PriceItem } from "@/lib/job-line-actions";

function rateFor(crew: number): number {
  if (crew <= 1) return 185;
  if (crew === 2) return 250;
  return 250 + (crew - 2) * 85;
}
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const CUSTOM = "__custom__";

export function AddJobLineItem({ hcpJobId }: { hcpJobId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<PriceItem[] | null>(null);
  const [q1, setQ1] = useState(""); const [q2, setQ2] = useState(""); const [q3, setQ3] = useState("");
  const [item, setItem] = useState("");
  const [customName, setCustomName] = useState("");
  const [hours, setHours] = useState("4");
  const [crew, setCrew] = useState("2");
  const [materials, setMaterials] = useState("0");
  const [description, setDescription] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && opts === null) getPricebookOptions().then(setOpts).catch(() => setOpts([]));
  }, [open, opts]);

  const q1s = useMemo(() => [...new Set((opts ?? []).map((o) => o.q1))].sort(), [opts]);
  const q2s = useMemo(() => [...new Set((opts ?? []).filter((o) => o.q1 === q1).map((o) => o.q2))].sort(), [opts, q1]);
  const q3s = useMemo(() => [...new Set((opts ?? []).filter((o) => o.q1 === q1 && o.q2 === q2).map((o) => o.q3))].sort(), [opts, q1, q2]);
  const items = useMemo(() => (opts ?? []).filter((o) => o.q1 === q1 && o.q2 === q2 && o.q3 === q3), [opts, q1, q2, q3]);

  const crewN = Math.max(1, Math.min(7, parseInt(crew) || 1));
  const hoursN = parseFloat(hours) || 0;
  const matsN = Math.max(0, parseFloat(materials) || 0);
  const price = hoursN * rateFor(crewN) + matsN * 1.3;
  const chosenName = item === CUSTOM ? customName.trim() : item;

  const inFlight = useRef(false);
  const submit = () => {
    if (inFlight.current || pending) return;   // hard guard against a double-fire billing the customer twice
    setErr(null); setMsg(null);
    if (!chosenName) { setErr("Pick a line item (or enter a custom name)."); return; }
    inFlight.current = true;
    start(async () => {
      const r = await addJobLineItem({ hcpJobId, itemName: chosenName, hours: hoursN, crewSize: crewN, materialsCost: matsN, description }).finally(() => { inFlight.current = false; });
      if (!r.ok) { setErr(r.error ?? "failed"); return; }
      setMsg(`Added “${chosenName}” — ${money(r.price ?? price)} on the job.`);
      router.refresh();
      setItem(""); setCustomName(""); setDescription("");
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100">
        ➕ Add line item to job
      </button>
    );
  }

  const inputCls = "mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm";
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">➕ Add line item (quick estimate)</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-500 hover:underline">close</button>
      </div>

      {opts === null ? (
        <div className="text-sm text-neutral-500">Loading pricebook…</div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">1 · Type</span>
              <select value={q1} onChange={(e) => { setQ1(e.target.value); setQ2(""); setQ3(""); setItem(""); }} className={inputCls}>
                <option value="">—</option>
                {q1s.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">2 · Category</span>
              <select value={q2} onChange={(e) => { setQ2(e.target.value); setQ3(""); setItem(""); }} disabled={!q1} className={inputCls}>
                <option value="">—</option>
                {q2s.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">3 · Work type</span>
              <select value={q3} onChange={(e) => { setQ3(e.target.value); setItem(""); }} disabled={!q2} className={inputCls}>
                <option value="">—</option>
                {q3s.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">4 · Item</span>
              <select value={item} onChange={(e) => setItem(e.target.value)} disabled={!q3} className={inputCls}>
                <option value="">—</option>
                {items.map((o) => <option key={o.item} value={o.item}>{o.item}{o.ref_price ? ` (ref ${money(o.ref_price)})` : ""}</option>)}
                <option value={CUSTOM}>Custom Plumbing Solution…</option>
              </select>
            </label>
          </div>
          {item === CUSTOM ? (
            <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Custom line item name" className={inputCls} />
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Hours</span>
              <input type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Crew</span>
              <select value={crew} onChange={(e) => setCrew(e.target.value)} className={inputCls}>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n} ({money(rateFor(n))}/hr)</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Materials $ (cost)</span>
              <input type="number" min="0" step="1" value={materials} onChange={(e) => setMaterials(e.target.value)} className={inputCls} />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Description / scope (include exclusions)</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls}
              placeholder="Scope + any exclusions (e.g. sheetrock repair not included)…" />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-neutral-700">
              Labor {money(hoursN * rateFor(crewN))} + materials {money(matsN * 1.3)} (×1.3) = <span className="font-semibold text-neutral-900">{money(price)}</span>
            </div>
            <button type="button" onClick={submit} disabled={pending || !chosenName}
              className="ml-auto rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
              {pending ? "Adding…" : "Add to job"}
            </button>
          </div>
          {msg ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div> : null}
          {err ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div> : null}
          <p className="text-[10px] text-neutral-400">Adds a line to the job&apos;s HCP invoice (no customer text). Materials marked up 1.3×, matching /estimate-draft.</p>
        </div>
      )}
    </div>
  );
}
