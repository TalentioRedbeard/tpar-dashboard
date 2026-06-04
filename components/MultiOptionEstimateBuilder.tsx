"use client";

// Multi-option estimate builder using the "4 questions + form" methodology
// (Danny 2026-06-02): each option holds one or more line items, and EACH line is
// built via the pricebook cascade (Type → Category → Work type → Item, + Custom)
// then priced by hours × crew rate + materials ×1.3 — identical math to
// AddJobLineItem. Multiple line items per option is optional. Pushes ALL options
// as one HCP estimate via createMultiOptionEstimate → create-estimate-direct.
//
// Used at /estimate/new, reachable from the customer page, estimates page, job
// page, and dashboard. If no customer is pre-scoped, it shows a customer picker.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getPricebookOptions, type PriceItem } from "@/lib/job-line-actions";
import {
  createMultiOptionEstimate,
  searchEstimateCustomers,
  getExcavatorModifier,
  type EstimateCustomerHit,
  type ModifierDef,
} from "@/lib/multi-option-estimate-actions";
import { generateLineDescription } from "@/lib/estimate-actions";

function rateFor(crew: number): number {
  if (crew <= 1) return 185;
  if (crew === 2) return 250;
  return 250 + (crew - 2) * 85;
}
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const CUSTOM = "__custom__";

type Line = {
  q1: string; q2: string; q3: string; item: string; customName: string;
  hours: string; crew: string; materials: string; description: string;
};
type Opt = { name: string; lines: Line[]; excavator: boolean };

const blankLine = (): Line => ({ q1: "", q2: "", q3: "", item: "", customName: "", hours: "4", crew: "2", materials: "0", description: "" });
const blankOpt = (i: number): Opt => ({ name: `Option ${i + 1}`, lines: [blankLine()], excavator: true });

function chosenName(l: Line): string { return l.item === CUSTOM ? l.customName.trim() : l.item; }
function linePrice(l: Line): number {
  const crew = Math.max(1, Math.min(7, parseInt(l.crew) || 1));
  const hours = parseFloat(l.hours) || 0;
  const mats = Math.max(0, parseFloat(l.materials) || 0);
  return hours * rateFor(crew) + mats * 1.3;
}

export function MultiOptionEstimateBuilder({
  initialCustomer,
  backHref,
}: {
  initialCustomer?: { hcpCustomerId: string; name: string } | null;
  backHref?: string;
}) {
  const router = useRouter();

  // ── Customer selection ──────────────────────────────────────────────────
  const [customer, setCustomer] = useState<{ hcpCustomerId: string; name: string } | null>(initialCustomer ?? null);
  const [addressId, setAddressId] = useState<string>("");
  const [addresses, setAddresses] = useState<EstimateCustomerHit["addresses"]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<EstimateCustomerHit[] | null>(null);
  const [searching, startSearch] = useTransition();

  function runSearch() {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    startSearch(async () => { setHits(await searchEstimateCustomers(term)); });
  }
  function pickCustomer(h: EstimateCustomerHit) {
    setCustomer({ hcpCustomerId: h.hcp_customer_id, name: h.display_name });
    setAddresses(h.addresses);
    setAddressId(h.addresses[0]?.address_id ?? "");
    setHits(null);
  }

  // ── Pricebook (loaded once, shared across all line cascades) ─────────────
  const [opts, setOpts] = useState<PriceItem[] | null>(null);
  useEffect(() => { if (opts === null) getPricebookOptions().then(setOpts).catch(() => setOpts([])); }, [opts]);
  const q1s = useMemo(() => [...new Set((opts ?? []).map((o) => o.q1))].sort(), [opts]);

  // Excavator equipment modifier (data-driven from price_modifiers). Auto-offered
  // per option when a chosen item suggests it (e.g. Sewer dig work).
  const [exc, setExc] = useState<ModifierDef | null>(null);
  useEffect(() => { getExcavatorModifier().then(setExc).catch(() => setExc(null)); }, []);

  // ── Options + lines state ───────────────────────────────────────────────
  const [options, setOptions] = useState<Opt[]>([blankOpt(0)]);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  function updateLine(oi: number, li: number, patch: Partial<Line>) {
    setOptions((prev) => prev.map((o, i) => i !== oi ? o : { ...o, lines: o.lines.map((l, j) => j !== li ? l : { ...l, ...patch }) }));
  }
  const addOption = () => setOptions((p) => [...p, blankOpt(p.length)]);
  const removeOption = (oi: number) => setOptions((p) => p.length === 1 ? p : p.filter((_, i) => i !== oi));
  const addLine = (oi: number) => setOptions((p) => p.map((o, i) => i !== oi ? o : { ...o, lines: [...o.lines, blankLine()] }));
  const removeLine = (oi: number, li: number) => setOptions((p) => p.map((o, i) => i !== oi ? o : o.lines.length === 1 ? o : { ...o, lines: o.lines.filter((_, j) => j !== li) }));
  const setOptName = (oi: number, name: string) => setOptions((p) => p.map((o, i) => i !== oi ? o : { ...o, name }));
  const setOptExcavator = (oi: number, v: boolean) => setOptions((p) => p.map((o, i) => i !== oi ? o : { ...o, excavator: v }));

  // ── Description generation (✨ Haiku, customer-facing scope in Danny's voice) ─
  // Same generator the voice-note EstimateBuilder uses. Per-line buttons + a
  // one-click "Polish all" so nothing ships as a bare line name again.
  const [genBusy, setGenBusy] = useState<Record<string, boolean>>({});
  const [genErr, setGenErr] = useState<Record<string, string | null>>({});
  const [polishing, setPolishing] = useState(false);

  async function genDesc(oi: number, li: number) {
    const line = options[oi]?.lines[li];
    if (!line) return;
    const name = chosenName(line);
    const scope = (line.description.trim() || name).trim();
    const key = `${oi}-${li}`;
    if (!scope) { setGenErr((p) => ({ ...p, [key]: "Pick an item or type a rough scope first." })); return; }
    setGenBusy((p) => ({ ...p, [key]: true }));
    setGenErr((p) => ({ ...p, [key]: null }));
    const fd = new FormData();
    fd.set("scope", scope);
    if (name) fd.set("line_item_name", name);
    const res = await generateLineDescription(fd);
    setGenBusy((p) => ({ ...p, [key]: false }));
    if (res.ok) updateLine(oi, li, { description: res.description });
    else setGenErr((p) => ({ ...p, [key]: res.error }));
  }

  // Polish every line that has a chosen item, in parallel — one click to turn
  // rough scope notes into customer-ready descriptions before pushing.
  async function polishAll() {
    const targets: Array<[number, number]> = [];
    options.forEach((o, oi) => o.lines.forEach((l, li) => { if (chosenName(l)) targets.push([oi, li]); }));
    if (targets.length === 0) return;
    setPolishing(true);
    await Promise.all(targets.map(([oi, li]) => genDesc(oi, li)));
    setPolishing(false);
  }

  // Excavator-fee helpers (per option). Days derived from the option's total
  // labor hours (÷8), half-day-ceiling per the modifier's min_increment.
  const itemModifiers = (l: Line): string[] => {
    const name = chosenName(l);
    if (!name) return [];
    return (opts ?? []).find((x) => x.q1 === l.q1 && x.q2 === l.q2 && x.q3 === l.q3 && x.item === name)?.modifiers ?? [];
  };
  const optionSuggestsExcavator = (o: Opt): boolean => !!exc && o.lines.some((l) => itemModifiers(l).includes("excavator_daily"));
  const sumHours = (o: Opt): number => o.lines.reduce((s, l) => s + (chosenName(l) ? (parseFloat(l.hours) || 0) : 0), 0);
  const excavatorDays = (o: Opt): number => {
    if (!exc) return 0;
    const inc = exc.minIncrement || 0.5;
    return Math.max(inc, Math.ceil((sumHours(o) / 8) / inc) * inc);
  };
  const excavatorFee = (o: Opt): number => (exc && o.excavator && optionSuggestsExcavator(o)) ? (excavatorDays(o) * exc.dailyRate + exc.deliveryCharge) : 0;

  const optTotal = (o: Opt) => o.lines.reduce((s, l) => s + (chosenName(l) ? linePrice(l) : 0), 0) + excavatorFee(o);
  const grandTotal = options.reduce((s, o) => s + optTotal(o), 0);
  const hasValid = options.some((o) => o.lines.some((l) => chosenName(l)));

  // ── Submit ──────────────────────────────────────────────────────────────
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ estimate_id: string; estimate_number: string; hcp_url: string | null } | null>(null);
  const inFlight = useRef(false);

  function submit() {
    if (inFlight.current || pending) return;
    setErr(null);
    if (!customer) { setErr("Pick a customer first."); return; }
    if (!hasValid) { setErr("Add at least one option with a line item — pick an item (Q4) or a Custom name."); return; }
    // Never silently drop an option/line. If the user filled something but left
    // no item name, block with a precise message so no option vanishes
    // (the 2026-06-02 "only 1 of 2 options reached HCP" bug).
    const problems: string[] = [];
    options.forEach((o, oi) => {
      const hasItem = o.lines.some((l) => chosenName(l));
      const startedNoName = o.lines.some((l) => !chosenName(l) && (l.q1 || l.q2 || l.q3 || l.description.trim() || (l.materials && l.materials !== "0") || (l.hours && l.hours !== "4")));
      if (!hasItem) problems.push(`Option ${oi + 1} has no item picked`);
      else if (startedNoName) problems.push(`Option ${oi + 1} has a started line with no item`);
    });
    if (problems.length > 0) {
      setErr(`Nothing sent — ${problems.join("; ")}. Pick an item (Q4) or a Custom name on each option, or remove the empty line/option.`);
      return;
    }
    inFlight.current = true;
    const payloadOptions = options.map((o) => {
      // quantity is intentionally 1: the 4-question form computes a full LINE
      // total (labor + materials ×1.3), so there's no per-unit multiplier — a
      // "5 fixtures" line captures all 5 in its hours/materials. unit_cost =
      // raw materials cost in cents, so HCP tracks materials cost separately
      // from the sell price (matches /estimate-draft + Add-line-item).
      const line_items = o.lines
        .filter((l) => chosenName(l))
        .map((l) => ({
          name: chosenName(l),
          description: l.description.trim() || undefined,
          quantity: 1,
          unit_price_cents: Math.round(linePrice(l) * 100),
          unit_cost_cents: Math.round(Math.max(0, parseFloat(l.materials) || 0) * 100),
        }));
      // Optional excavator equipment fee → its own transparent line item so the
      // customer sees the rental + delivery, and margin reporting treats it as cost.
      const fee = excavatorFee(o);
      if (fee > 0 && exc) {
        const days = excavatorDays(o);
        line_items.push({
          name: `${exc.label} (${days} day${days === 1 ? "" : "s"})`,
          description: "Excavator daily rental + round-trip delivery.",
          quantity: 1,
          unit_price_cents: Math.round(fee * 100),
          unit_cost_cents: Math.round(fee * 100),
        });
      }
      return { name: o.name.trim() || "Option", line_items };
    }).filter((o) => o.line_items.length > 0);

    start(async () => {
      const r = await createMultiOptionEstimate({
        hcpCustomerId: customer.hcpCustomerId,
        addressId: addressId || undefined,
        note: note.trim() || undefined,
        message: message.trim() || undefined,
        options: payloadOptions,
      }).finally(() => { inFlight.current = false; });
      if (r.ok) setResult({ estimate_id: r.estimate_id, estimate_number: r.estimate_number, hcp_url: r.hcp_url });
      else setErr(r.error);
    });
  }

  const inputCls = "mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  // ── Success ─────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-lg font-semibold text-emerald-900">
          Estimate {result.estimate_number || ""} pushed to HCP
        </h2>
        <p className="mt-1 text-sm text-emerald-800">{customer?.name} · {options.length} option{options.length === 1 ? "" : "s"} · {money(grandTotal)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {result.hcp_url ? (
            <a href={result.hcp_url} target="_blank" rel="noreferrer" className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">Open in HCP ↗</a>
          ) : null}
          {customer ? (
            <button type="button" onClick={() => router.push(`/customer/${customer.hcpCustomerId}`)} className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-100">Back to customer</button>
          ) : null}
          <button type="button" onClick={() => { setResult(null); setOptions([blankOpt(0)]); setNote(""); setMessage(""); setErr(null); }} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">Build another</button>
        </div>
        <p className="mt-3 text-xs text-emerald-700">It&apos;ll appear on the customer&apos;s page after the next HCP sync.</p>
      </div>
    );
  }

  // ── Customer picker (only when no customer scoped) ──────────────────────
  if (!customer) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-neutral-900">Who is this estimate for?</h3>
        <div className="mt-3 flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } }}
            placeholder="Search customers by name, email, or phone…"
            className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <button type="button" onClick={runSearch} disabled={searching || q.trim().length < 2} className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        {hits !== null ? (
          hits.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">No matches. Try a different name/phone.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {hits.map((h) => (
                <li key={h.hcp_customer_id}>
                  <button type="button" onClick={() => pickCustomer(h)} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-sm hover:border-brand-300 hover:bg-brand-50">
                    <span className="font-medium text-neutral-900">{h.display_name}</span>
                    <span className="ml-2 text-xs text-neutral-500">{[h.email, h.phone10].filter(Boolean).join(" · ")}</span>
                    {h.addresses.length > 0 ? <span className="ml-2 text-xs text-neutral-400">{h.addresses.length} address{h.addresses.length === 1 ? "" : "es"}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {backHref ? <button type="button" onClick={() => router.push(backHref)} className="mt-4 text-xs text-neutral-500 hover:underline">Cancel</button> : null}
      </div>
    );
  }

  // ── Builder ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Customer header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-neutral-200 bg-white p-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">Estimate for</div>
          <div className="mt-0.5 font-medium text-neutral-900">{customer.name}</div>
          {addresses.length > 1 ? (
            <select value={addressId} onChange={(e) => setAddressId(e.target.value)} className="mt-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs">
              {addresses.map((a) => <option key={a.address_id} value={a.address_id}>{[a.street, a.city].filter(Boolean).join(", ") || a.address_id}</option>)}
            </select>
          ) : null}
        </div>
        {!initialCustomer ? (
          <button type="button" onClick={() => { setCustomer(null); setHits(null); setAddresses([]); setAddressId(""); }} className="text-xs text-neutral-500 hover:underline">change customer</button>
        ) : null}
      </div>

      {opts === null ? <div className="text-sm text-neutral-500">Loading pricebook…</div> : null}

      {/* Options */}
      {options.map((o, oi) => (
        <div key={oi} className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <input value={o.name} onChange={(e) => setOptName(oi, e.target.value)} placeholder={`Option ${oi + 1} name (e.g. "PVC bypass — code-compliant")`}
              className="min-w-[240px] flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm font-semibold focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            <span className="text-xs text-neutral-500">Total: <span className="font-semibold text-neutral-800">{money(optTotal(o))}</span></span>
            {options.length > 1 ? <button type="button" onClick={() => removeOption(oi)} className="text-xs text-red-700 hover:text-red-900">remove option</button> : null}
          </div>

          {o.lines.map((l, li) => {
            const q2s = [...new Set((opts ?? []).filter((x) => x.q1 === l.q1).map((x) => x.q2))].sort();
            const q3s = [...new Set((opts ?? []).filter((x) => x.q1 === l.q1 && x.q2 === l.q2).map((x) => x.q3))].sort();
            const items = (opts ?? []).filter((x) => x.q1 === l.q1 && x.q2 === l.q2 && x.q3 === l.q3);
            return (
              <div key={li} className="mb-2 rounded-md border border-neutral-100 bg-neutral-50 p-3">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <label className="block"><span className="text-xs font-medium text-neutral-600">1 · Type</span>
                    <select value={l.q1} onChange={(e) => updateLine(oi, li, { q1: e.target.value, q2: "", q3: "", item: "" })} className={inputCls}>
                      <option value="">—</option>{q1s.map((v) => <option key={v} value={v}>{v} ({(opts ?? []).filter((x) => x.q1 === v).length})</option>)}
                    </select></label>
                  <label className="block"><span className="text-xs font-medium text-neutral-600">2 · Category</span>
                    <select value={l.q2} onChange={(e) => updateLine(oi, li, { q2: e.target.value, q3: "", item: "" })} disabled={!l.q1} className={inputCls}>
                      <option value="">—</option>{q2s.map((v) => <option key={v} value={v}>{v} ({(opts ?? []).filter((x) => x.q1 === l.q1 && x.q2 === v).length})</option>)}
                    </select></label>
                  <label className="block"><span className="text-xs font-medium text-neutral-600">3 · Work type</span>
                    <select value={l.q3} onChange={(e) => updateLine(oi, li, { q3: e.target.value, item: "" })} disabled={!l.q2} className={inputCls}>
                      <option value="">—</option>{q3s.map((v) => <option key={v} value={v}>{v} ({(opts ?? []).filter((x) => x.q1 === l.q1 && x.q2 === l.q2 && x.q3 === v).length})</option>)}
                    </select></label>
                  <label className="block"><span className="text-xs font-medium text-neutral-600">4 · Item</span>
                    <select value={l.item} onChange={(e) => updateLine(oi, li, { item: e.target.value })} disabled={!l.q3} className={inputCls}>
                      <option value="">—</option>
                      {items.map((x) => <option key={x.item} value={x.item}>{x.item}{x.ref_price ? ` (ref ${money(x.ref_price)})` : ""}</option>)}
                      <option value={CUSTOM}>Custom Plumbing Solution…</option>
                    </select></label>
                </div>
                {l.item === CUSTOM ? (
                  <input value={l.customName} onChange={(e) => updateLine(oi, li, { customName: e.target.value })} placeholder="Custom line item name" className={inputCls} />
                ) : null}

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <label className="block"><span className="text-xs font-medium text-neutral-600">Hours</span>
                    <input type="number" min="0" step="0.5" value={l.hours} onChange={(e) => updateLine(oi, li, { hours: e.target.value })} className={inputCls} /></label>
                  <label className="block"><span className="text-xs font-medium text-neutral-600">Crew</span>
                    <select value={l.crew} onChange={(e) => updateLine(oi, li, { crew: e.target.value })} className={inputCls}>
                      {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n} ({money(rateFor(n))}/hr)</option>)}
                    </select></label>
                  <label className="block"><span className="text-xs font-medium text-neutral-600">Materials $ (cost)</span>
                    <input type="number" min="0" step="1" value={l.materials} onChange={(e) => updateLine(oi, li, { materials: e.target.value })} className={inputCls} /></label>
                </div>

                <label className="mt-2 block"><span className="text-xs font-medium text-neutral-600">Description / scope (customer-facing; include exclusions)</span>
                  <textarea value={l.description} onChange={(e) => updateLine(oi, li, { description: e.target.value })} rows={2} className={inputCls}
                    placeholder="Scope + exclusions (e.g. concrete cut/patch included; sheetrock repair NOT included)…" /></label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => genDesc(oi, li)} disabled={genBusy[`${oi}-${li}`] || !chosenName(l)}
                    title="Rewrite this line's scope into a customer-facing description in Danny's voice (Claude Haiku)."
                    className="rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50">
                    {genBusy[`${oi}-${li}`] ? "Generating…" : "✨ Generate description"}
                  </button>
                  {genErr[`${oi}-${li}`] ? <span className="text-xs text-red-700">{genErr[`${oi}-${li}`]}</span> : null}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-neutral-700">
                    Labor {money((parseFloat(l.hours) || 0) * rateFor(Math.max(1, Math.min(7, parseInt(l.crew) || 1))))} + materials {money(Math.max(0, parseFloat(l.materials) || 0) * 1.3)} (×1.3) = <span className="font-semibold text-neutral-900">{money(linePrice(l))}</span>
                  </span>
                  {o.lines.length > 1 ? <button type="button" onClick={() => removeLine(oi, li)} className="ml-auto text-xs text-red-700 hover:text-red-900">× remove line</button> : null}
                </div>
              </div>
            );
          })}

          <button type="button" onClick={() => addLine(oi)} className="mt-1 text-xs font-medium text-brand-700 underline hover:text-brand-900">+ add line item to this option</button>

          {optionSuggestsExcavator(o) ? (
            <label className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <input type="checkbox" checked={o.excavator} onChange={(e) => setOptExcavator(oi, e.target.checked)} />
              <span className="font-medium">🚜 {exc?.label ?? "Excavator equipment fee"}</span>
              {o.excavator ? (
                <span className="font-semibold">{excavatorDays(o)} day{excavatorDays(o) === 1 ? "" : "s"} → {money(excavatorFee(o))}</span>
              ) : <span className="text-amber-600">(off)</span>}
              <span className="ml-auto text-[10px] text-amber-600">auto-suggested for excavation · ${exc?.dailyRate ?? 250}/day + ${exc?.deliveryCharge ?? 125} delivery, ½-day ceiling from hours</span>
            </label>
          ) : null}
        </div>
      ))}

      <button type="button" onClick={addOption} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
        + Add option
      </button>

      {/* Notes */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="text-xs"><span className="mb-1 block font-medium text-neutral-600">Internal note (HCP Pro Notes)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={inputCls} placeholder="Scope / internal context (not customer-facing)" /></label>
        <label className="text-xs"><span className="mb-1 block font-medium text-neutral-600">Customer-facing message (HCP PDF prose)</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className={inputCls} placeholder="Free-form prose shown to the customer above the options" /></label>
      </div>

      {/* Submit */}
      <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-4">
        <div className="text-sm text-neutral-600">Grand total (all options): <span className="text-base font-semibold text-neutral-900">{money(grandTotal)}</span></div>
        {hasValid ? (
          <button type="button" onClick={polishAll} disabled={polishing || pending}
            title="Rewrite every line's scope into a customer-facing description in Danny's voice (Claude Haiku). Review before pushing."
            className="rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50">
            {polishing ? "Polishing…" : "✨ Polish all descriptions"}
          </button>
        ) : null}
        <button type="button" onClick={submit} disabled={pending || !hasValid} className="ml-auto rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300">
          {pending ? "Pushing to HCP…" : `Push ${options.length} option${options.length === 1 ? "" : "s"} as one HCP estimate →`}
        </button>
        {backHref ? <button type="button" onClick={() => router.push(backHref)} disabled={pending} className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">Cancel</button> : null}
      </div>
      {err ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div> : null}
      <p className="text-[10px] text-neutral-400">Each option = one HCP estimate option; the customer picks. Materials marked up ×1.3, crew rates 185/250/+85, matching /estimate-draft + Add-line-item.</p>
    </div>
  );
}
