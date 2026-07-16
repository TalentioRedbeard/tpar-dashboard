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
  sendBuilderEstimateTracked,
  generateEstimateWriteup,
  searchEstimateCustomers,
  loadEstimateModifiers,
  loadEstimateTechs,
  type EstimateCustomerHit,
  type EstimateTech,
  type EstimateModifier,
} from "@/lib/multi-option-estimate-actions";
import { generateLineDescription } from "@/lib/estimate-actions";
import { materialsForService, type ServiceMaterials } from "@/lib/bom-estimate-actions";
import { rateFor, linePriceDollars, materialsCostCents, applyOptionModifiers, type ModLine } from "@/lib/estimate-pricing";
import { BasedOnPanel } from "./BasedOnPanel";
import { PriceItWithMe } from "./PriceItWithMe";
import { generateBasedOnEstimate, type BasedOnDraftOption } from "@/lib/based-on-actions";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const CUSTOM = "__custom__";

// Exported for the "Price it with me" panel (components/PriceItWithMe), which
// injects pre-filled Lines via onAddLines. Type-only there — no runtime cycle.
export type Line = {
  q1: string; q2: string; q3: string; item: string; customName: string;
  hours: string; crew: string; materials: string; description: string;
  modifierKeys: string[];
  // Value-based per-line sell price (from the estimate engine, or hand-entered).
  // When set, it overrides the labor/materials cost-plus formula for the sell
  // price. Empty string = revert to the formula (lineModified).
  priceOverride: string;
};
type Opt = { name: string; lines: Line[] };

const blankLine = (): Line => ({ q1: "", q2: "", q3: "", item: "", customName: "", hours: "4", crew: "2", materials: "0", description: "", modifierKeys: [], priceOverride: "" });
const blankOpt = (i: number): Opt => ({ name: `Option ${i + 1}`, lines: [blankLine()] });

// An untouched blank line (still at blankLine() defaults) — safe to replace
// when the "Price it with me" panel injects its first proposed lines.
const isPristineLine = (l: Line): boolean =>
  !l.q1 && !l.q2 && !l.q3 && !l.item && !l.customName.trim() && !l.description.trim()
  && l.hours === "4" && l.crew === "2" && l.materials === "0"
  && l.modifierKeys.length === 0 && l.priceOverride === "";

function chosenName(l: Line): string { return l.item === CUSTOM ? l.customName.trim() : l.item; }
const linePrice = (l: Line): number => linePriceDollars(l.hours, l.crew, l.materials);

// Effect types the per-line picker offers. Discount/promo are HCP-manual for now
// (HCP estimate lines can't carry a negative/override price cleanly), so they're
// excluded here and the compute engine simply never sees them selected.
const PICKER_EFFECTS = new Set(["hourly_rate_add", "labor_multiplier", "equipment_charge", "permit", "floor_price"]);

function modEffectLabel(m: EstimateModifier): string {
  switch (m.effectType) {
    case "hourly_rate_add":
      return `+$${m.rateAddPerJob ?? 0}/hr${m.rateAddPerAdditionalTech ? ` +$${m.rateAddPerAdditionalTech}/tech` : ""}`;
    case "labor_multiplier":
      return `labor ×${(1 + (m.laborMultiplier ?? 0)).toFixed(2)}`;
    case "equipment_charge":
      return m.dailyRate != null
        ? `$${m.dailyRate}/day +$${m.deliveryCharge ?? 0} del`
        : `$${m.floorAmount ?? 0} +$${m.hourlyRateAfterFloor ?? 0}/hr after ${m.floorHoursThreshold ?? 0}h`;
    case "permit":
      return `+$${m.rateAddPerJob ?? 0}`;
    case "floor_price":
      return `floor $${m.floorAmount ?? 0}`;
    default:
      return m.effectType;
  }
}

export function MultiOptionEstimateBuilder({
  initialCustomer,
  initialJob,
  backHref,
  autoSeed,
}: {
  initialCustomer?: { hcpCustomerId: string; name: string } | null;
  initialJob?: {
    hcpJobId: string;
    addressId: string | null;
    techEmployeeId: string | null;
    techName: string | null;
  } | null;
  backHref?: string;
  // When set (e.g. entering from an estimate appointment), the builder runs the
  // estimate engine ONCE on mount from these visit notes/photos and pre-fills
  // good/better/best for the operator to review before pushing.
  autoSeed?: { freeform: string; imageUrls?: string[] } | null;
}) {
  const router = useRouter();

  // ── Customer selection ──────────────────────────────────────────────────
  const [customer, setCustomer] = useState<{ hcpCustomerId: string; name: string } | null>(initialCustomer ?? null);
  const [addressId, setAddressId] = useState<string>(initialJob?.addressId ?? "");
  const [addresses, setAddresses] = useState<EstimateCustomerHit["addresses"]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<EstimateCustomerHit[] | null>(null);
  const [searching, startSearch] = useTransition();

  // ── Assigned tech ────────────────────────────────────────────────────────
  // HCP drops the technician unless we pass assigned_employee_ids. Inherited
  // from the job when opened from one (⚡ auto-filled); otherwise picked here so
  // a tech is assigned to every new estimate (Danny 2026-06-04).
  const [techs, setTechs] = useState<EstimateTech[]>([]);
  const [techId, setTechId] = useState<string>(initialJob?.techEmployeeId ?? "");
  useEffect(() => { loadEstimateTechs().then(setTechs).catch(() => setTechs([])); }, []);

  // The job's assigned tech may be filtered out of loadEstimateTechs (inactive,
  // test, or a manager/office assignment). Surface it as an option anyway so the
  // <select> shows + submits the inherited id instead of silently reading
  // "unassigned" while techId still ships the inherited value.
  const techOptions = useMemo<EstimateTech[]>(() => {
    const wanted = initialJob?.techEmployeeId;
    if (!wanted || techs.some((t) => t.hcp_employee_id === wanted)) return techs;
    return [
      { hcp_employee_id: wanted, tech_short_name: initialJob?.techName ?? "(assigned tech)", hcp_full_name: initialJob?.techName ?? "", is_lead: false },
      ...techs,
    ];
  }, [techs, initialJob]);

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

  // Active price_modifiers for the per-line picker (search all + recommend the
  // line item's pricebook-tagged ones).
  const [mods, setMods] = useState<EstimateModifier[]>([]);
  useEffect(() => { loadEstimateModifiers().then(setMods).catch(() => setMods([])); }, []);
  const modMap = useMemo<Record<string, EstimateModifier>>(() => Object.fromEntries(mods.map((m) => [m.key, m])), [mods]);
  const pickerMods = useMemo(() => mods.filter((m) => PICKER_EFFECTS.has(m.effectType)), [mods]);
  const [modSearch, setModSearch] = useState<Record<string, string>>({});

  // ── Options + lines state ───────────────────────────────────────────────
  const [options, setOptions] = useState<Opt[]>([blankOpt(0)]);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  // ── Approved-BOM materials hint (BUILD 2) ─────────────────────────────────
  // When a line's Q4 item maps to a service with an APPROVED service_bom, show
  // its deterministic standard-materials cost as an accept-able suggestion —
  // never auto-filled (human-in-the-loop). Cache by item name so each service is
  // fetched once: a ServiceMaterials value = has a bom, null = no bom (don't
  // refetch), undefined = not yet loaded (no hint).
  const [bomHints, setBomHints] = useState<Record<string, ServiceMaterials | null>>({});
  const bomInFlight = useRef<Set<string>>(new Set());
  useEffect(() => {
    const names = new Set<string>();
    for (const o of options) for (const l of o.lines) {
      if (l.item && l.item !== CUSTOM) names.add(l.item);
    }
    for (const name of names) {
      if (name in bomHints || bomInFlight.current.has(name)) continue;
      bomInFlight.current.add(name);
      materialsForService(name)
        .then((res) => setBomHints((p) => ({ ...p, [name]: res })))
        .catch(() => setBomHints((p) => ({ ...p, [name]: null })))
        .finally(() => bomInFlight.current.delete(name));
    }
  }, [options, bomHints]);

  // ── Auto-seed from an estimate appointment (one-shot) ────────────────────
  const ranRef = useRef(false);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  function updateLine(oi: number, li: number, patch: Partial<Line>) {
    setOptions((prev) => prev.map((o, i) => i !== oi ? o : { ...o, lines: o.lines.map((l, j) => j !== li ? l : { ...l, ...patch }) }));
  }
  const addOption = () => setOptions((p) => [...p, blankOpt(p.length)]);
  const removeOption = (oi: number) => setOptions((p) => p.length === 1 ? p : p.filter((_, i) => i !== oi));
  const addLine = (oi: number) => setOptions((p) => p.map((o, i) => i !== oi ? o : { ...o, lines: [...o.lines, blankLine()] }));
  const removeLine = (oi: number, li: number) => setOptions((p) => p.map((o, i) => i !== oi ? o : o.lines.length === 1 ? o : { ...o, lines: o.lines.filter((_, j) => j !== li) }));
  const setOptName = (oi: number, name: string) => setOptions((p) => p.map((o, i) => i !== oi ? o : { ...o, name }));
  const toggleMod = (oi: number, li: number, key: string) =>
    setOptions((p) => p.map((o, i) => i !== oi ? o : { ...o, lines: o.lines.map((l, j) => j !== li ? l : { ...l, modifierKeys: l.modifierKeys.includes(key) ? l.modifierKeys.filter((k) => k !== key) : [...l.modifierKeys, key] }) }));

  // ── Description generation (✨ Haiku, customer-facing scope in Danny's voice) ─
  // Same generator the voice-note EstimateBuilder uses. Per-line buttons + a
  // one-click "Polish all" so nothing ships as a bare line name again.
  const [genBusy, setGenBusy] = useState<Record<string, boolean>>({});
  const [genErr, setGenErr] = useState<Record<string, string | null>>({});
  const [polishing, setPolishing] = useState(false);
  const [writeupBusy, setWriteupBusy] = useState(false);
  const [writeupErr, setWriteupErr] = useState<string | null>(null);

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

  // (b) Whole-estimate write-up → fills the customer-facing message in Danny's
  // voice (Summary / Work Description / Notes). The full Danny's Descriptions
  // generator on Sonnet, not the per-line blurb.
  async function genWriteup() {
    const payloadOptions = options
      .map((o) => ({
        name: o.name.trim() || "Option",
        line_items: o.lines
          .filter((l) => chosenName(l))
          .map((l) => ({ name: chosenName(l), description: l.description.trim() || undefined })),
      }))
      .filter((o) => o.line_items.length > 0);
    if (payloadOptions.length === 0) { setWriteupErr("Add at least one option with a line item first."); return; }
    setWriteupBusy(true);
    setWriteupErr(null);
    const addr = addresses.find((a) => a.address_id === addressId);
    const res = await generateEstimateWriteup({
      options: payloadOptions,
      customerName: customer?.name,
      address: addr ? [addr.street, addr.city].filter(Boolean).join(", ") : undefined,
    });
    setWriteupBusy(false);
    if (res.ok) setMessage(res.writeup);
    else setWriteupErr(res.error);
  }

  // Fill the builder from a "Based On…" generated draft. Each generated line
  // becomes a Custom line item the operator reviews + adjusts; the builder
  // recomputes price from hours/crew/materials. Replaces the current draft.
  function applyBasedOn(draft: BasedOnDraftOption[], draftNote: string) {
    if (!draft || draft.length === 0) return;
    setOptions(draft.map((o) => ({
      name: o.name || "Option",
      lines: (o.lines.length ? o.lines : [{ name: "", description: "", hours: "4", crew: "2", materials: "0", price: "" }]).map((l) => ({
        q1: "", q2: "", q3: "", item: CUSTOM, customName: l.name,
        hours: l.hours || "0", crew: l.crew || "2", materials: l.materials || "0", description: l.description || "",
        modifierKeys: [],
        // Carry the engine's value-based price as the sell-price override; the
        // hours/crew/materials stay as the visible cost basis beneath it.
        priceOverride: l.price || "",
      })),
    })));
    if (draftNote && !note.trim()) setNote(draftNote);
  }

  // Inject proposed lines from the "Price it with me" panel into one option.
  // Replaces a single still-pristine blank line, otherwise appends. The tech
  // reviews every number in the normal form before pushing (human-in-the-loop).
  function addConversationLines(optionIndex: number, lines: Line[]) {
    if (lines.length === 0) return;
    setOptions((prev) => prev.map((o, i) => {
      if (i !== Math.max(0, Math.min(optionIndex, prev.length - 1))) return o;
      const pristine = o.lines.length === 1 && isPristineLine(o.lines[0]);
      return { ...o, lines: pristine ? [...lines] : [...o.lines, ...lines] };
    }));
  }

  // One-shot auto-seed: when entering from an estimate appointment, run the
  // estimate engine ONCE on the visit notes/photos and pre-fill good/better/best.
  // Guarded by ranRef so it fires exactly once even across re-renders. On
  // failure, the empty manual builder is left intact with a soft notice.
  useEffect(() => {
    if (ranRef.current) return;
    if (!customer || !autoSeed?.freeform?.trim()) return;
    ranRef.current = true;
    setSeeding(true);
    setSeedMsg(null);
    (async () => {
      try {
        const res = await generateBasedOnEstimate(customer.hcpCustomerId, {
          freeform: autoSeed.freeform,
          uploadedImageUrls: autoSeed.imageUrls,
        });
        if (res.ok) applyBasedOn(res.options, res.note);
        else setSeedMsg(`Couldn't draft from the visit notes (${res.error}). Build manually below.`);
      } catch (e) {
        setSeedMsg(`Couldn't draft from the visit notes (${e instanceof Error ? e.message : String(e)}). Build manually below.`);
      } finally {
        setSeeding(false);
      }
    })();
  }, [customer, autoSeed]);

  // A line item's pricebook-tagged modifier keys — floated up as "recommended"
  // in the picker (the same tags the old excavator auto-suggest used).
  const itemModifiers = (l: Line): string[] => {
    const name = chosenName(l);
    if (!name) return [];
    return (opts ?? []).find((x) => x.q1 === l.q1 && x.q2 === l.q2 && x.q3 === l.q3 && x.item === name)?.modifiers ?? [];
  };
  const recommendedKeys = (l: Line): string[] => {
    const avail = new Set(pickerMods.map((m) => m.key));
    return itemModifiers(l).filter((k) => avail.has(k));
  };

  // Run one option through the modifier compute engine (chosen lines only):
  // adjusted line prices + transparent equipment/permit lines + the option total.
  const computeOption = (o: Opt) =>
    applyOptionModifiers(
      o.lines.filter((l) => chosenName(l)).map((l): ModLine => ({ hours: l.hours, crew: l.crew, materials: l.materials, modifierKeys: l.modifierKeys })),
      modMap,
    );
  // One chosen line's modifier-adjusted sell price (for the per-line readout).
  const lineModified = (o: Opt, l: Line): number => {
    if (!chosenName(l)) return 0;
    const chosen = o.lines.filter((x) => chosenName(x));
    return computeOption(o).lines[chosen.indexOf(l)]?.price ?? linePrice(l);
  };

  // The SELL price for a chosen line: the value-based price override when set
  // (the engine's suggested_price, or a hand-entered number), else the
  // modifier-adjusted cost-plus formula price. This is what gets totaled, pushed
  // to HCP, and shown bold per line.
  const lineSellPrice = (o: Opt, l: Line): number => {
    const ov = parseFloat(l.priceOverride);
    return (l.priceOverride.trim() !== "" && Number.isFinite(ov) && ov >= 0) ? ov : lineModified(o, l);
  };

  // Base sum = chosen lines at their SELL price, PLUS modifier extra lines
  // (equipment/permit) which the compute engine surfaces separately.
  const optTotal = (o: Opt) =>
    o.lines.filter(chosenName).reduce((s, l) => s + lineSellPrice(o, l), 0)
    + computeOption(o).extraLines.reduce((s, e) => s + e.price, 0);
  const grandTotal = options.reduce((s, o) => s + optTotal(o), 0);
  const hasValid = options.some((o) => o.lines.some((l) => chosenName(l)));

  // ── Submit ──────────────────────────────────────────────────────────────
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ estimate_id: string; estimate_number: string; hcp_url: string | null; bid_estimate_id: string | null } | null>(null);
  const inFlight = useRef(false);

  // ── Tracked send (from the success screen) ───────────────────────────────
  const [sendPending, startSend] = useTransition();
  const [sendDone, setSendDone] = useState(false);
  const [sendViewUrl, setSendViewUrl] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [sendToEmail, setSendToEmail] = useState("");

  function sendTracked() {
    if (!result?.estimate_id || sendPending) return;
    setSendErr(null);
    startSend(async () => {
      const res = await sendBuilderEstimateTracked(
        result.estimate_id,
        showSendEmail && sendToEmail.trim() ? { toEmail: sendToEmail.trim() } : undefined,
      );
      if (res.ok) { setSendDone(true); setSendViewUrl(res.view_url); setShowSendEmail(false); }
      else { setSendErr(res.error); if (/email/i.test(res.error)) setShowSendEmail(true); }
    });
  }

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
      // total. Base lines carry their modifier-adjusted sell price (rate
      // premiums / labor multipliers / floors baked in via the compute engine);
      // unit_cost stays the raw materials cost. (matches /estimate-draft.)
      const chosen = o.lines.filter((l) => chosenName(l));
      const oc = computeOption(o);
      const line_items: Array<{ name: string; description?: string; quantity: number; unit_price_cents: number; unit_cost_cents: number; labor_hours: number }> =
        chosen.map((l) => ({
          name: chosenName(l),
          description: l.description.trim() || undefined,
          quantity: 1,
          // Sell price honors the value-based override (engine suggested_price /
          // hand-entered); falls back to the modifier-adjusted cost-plus formula.
          unit_price_cents: Math.round(lineSellPrice(o, l) * 100),
          unit_cost_cents: materialsCostCents(l.materials),
          // Carried only for the first-class bid_estimate_lines record (not HCP).
          labor_hours: Math.max(0, parseFloat(l.hours) || 0),
        }));
      // Equipment / permit modifiers → their own transparent line items so the
      // customer sees the charge and margin reporting treats it as cost.
      for (const e of oc.extraLines) {
        line_items.push({
          name: e.name,
          description: e.kind === "equipment" ? "Equipment rental + round-trip delivery." : e.kind === "permit" ? "Permit fee (pass-through)." : undefined,
          quantity: 1,
          unit_price_cents: Math.round(e.price * 100),
          unit_cost_cents: Math.round(e.price * 100),
          labor_hours: 0,
        });
      }
      return { name: o.name.trim() || "Option", line_items };
    }).filter((o) => o.line_items.length > 0);

    start(async () => {
      const r = await createMultiOptionEstimate({
        hcpCustomerId: customer.hcpCustomerId,
        customerName: customer.name,
        addressId: addressId || undefined,
        assignedEmployeeIds: techId ? [techId] : undefined,
        hcpJobId: initialJob?.hcpJobId,
        note: note.trim() || undefined,
        message: message.trim() || undefined,
        options: payloadOptions,
      }).finally(() => { inFlight.current = false; });
      if (r.ok) setResult({ estimate_id: r.estimate_id, estimate_number: r.estimate_number, hcp_url: r.hcp_url, bid_estimate_id: r.bid_estimate_id });
      else setErr(r.error);
    });
  }

  const inputCls = "mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  // ── Success ─────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-lg font-semibold text-emerald-900">
          Estimate {result.estimate_number || ""} created ✓
        </h2>
        <p className="mt-1 text-sm text-emerald-800">{customer?.name} · {options.length} option{options.length === 1 ? "" : "s"} · {money(grandTotal)} · synced to Housecall Pro</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {/* In-app landing (A3/A4, 2026-07-16): the csr_ id opens the rich
              /estimate/[id] template page; the HCP tab is retired on tech
              surfaces (leadership reaches HCP from that page's gated button). */}
          <button type="button" onClick={() => router.push(`/estimate/${result.estimate_id}`)} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">
            View estimate →
          </button>
          {initialJob?.hcpJobId ? (
            <button type="button" onClick={() => router.push(`/job/${initialJob.hcpJobId}`)} className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800">Back to job →</button>
          ) : null}
          {customer ? (
            <button type="button" onClick={() => router.push(`/customer/${customer.hcpCustomerId}`)} className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-100">Back to customer</button>
          ) : null}
          <button type="button" onClick={() => { setResult(null); setOptions([blankOpt(0)]); setNote(""); setMessage(""); setErr(null); setSendDone(false); setSendViewUrl(null); setSendErr(null); setShowSendEmail(false); setSendToEmail(""); }} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">Build another</button>
        </div>

        {/* Tracked send — Phase 1 spine reconnect. Sends the branded, tracked
            Resend estimate email (the /e hosted page + delivered/viewed/clicked
            tracking + the follow-up engine all key off the estimate_sends row
            this creates). Reachable here in one click; also available later on
            the estimate page. */}
        <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
          {!sendDone ? (
            <>
              <div className="text-sm font-medium text-neutral-900">Send it to the customer (tracked)</div>
              <p className="mt-0.5 text-xs text-neutral-500">
                Emails a branded estimate page via Resend and tracks delivered / viewed / clicked. You can also send it later from the estimate page.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={sendTracked} disabled={sendPending}
                  className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
                  {sendPending ? "Sending…" : "Send to customer (tracked) →"}
                </button>
                {/* csr_ id → the rich template page (the bid-uuid route is the
                    sparse legacy edit page; estimate_id is always present while
                    bid_estimate_id can be null when the persist RPC fails). */}
                <button type="button" onClick={() => router.push(`/estimate/${result.estimate_id}`)}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">
                  Open estimate →
                </button>
              </div>
              {showSendEmail ? (
                <div className="mt-2 flex items-center gap-2">
                  <input type="email" value={sendToEmail} onChange={(e) => setSendToEmail(e.target.value)}
                    placeholder="recipient@email.com"
                    className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none" />
                  <button type="button" onClick={sendTracked} disabled={sendPending || !sendToEmail.trim()}
                    className="rounded-md bg-navy-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-900 disabled:opacity-50">
                    Send
                  </button>
                </div>
              ) : null}
              {sendErr ? <div className="mt-2 text-xs text-red-600">{sendErr}</div> : null}
            </>
          ) : (
            <div className="text-sm">
              <span className="font-medium text-emerald-700">Sent ✓</span>
              <span className="text-neutral-600"> — we&rsquo;ll track delivery + opens.</span>
              {sendViewUrl ? (
                <a href={sendViewUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-brand-700 hover:underline">
                  View the customer&rsquo;s page ↗
                </a>
              ) : null}
            </div>
          )}
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
        {/* Assigned tech — inherited from the job (⚡) or chosen here */}
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            Assigned tech
            {initialJob?.techEmployeeId && techId === initialJob.techEmployeeId ? (
              <span className="ml-1.5 font-normal normal-case text-brand-600">⚡ from job</span>
            ) : null}
          </div>
          <select
            value={techId}
            onChange={(e) => setTechId(e.target.value)}
            className="mt-0.5 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
          >
            <option value="">— unassigned —</option>
            {techOptions.map((t) => (
              <option key={t.hcp_employee_id} value={t.hcp_employee_id}>
                {(t.tech_short_name || t.hcp_full_name) || t.hcp_employee_id}{t.is_lead ? " (lead)" : ""}
              </option>
            ))}
          </select>
        </div>
        {!initialCustomer ? (
          <button type="button" onClick={() => { setCustomer(null); setHits(null); setAddresses([]); setAddressId(""); }} className="text-xs text-neutral-500 hover:underline">change customer</button>
        ) : null}
      </div>

      {/* Based On… — seed the builder from notes / voice notes / comms / 360s */}
      <div className="flex flex-wrap items-center gap-2">
        <BasedOnPanel hcpCustomerId={customer.hcpCustomerId} onApply={applyBasedOn} disabled={pending} />
        <span className="text-xs text-neutral-400">…or build manually below</span>
      </div>

      {/* 🧮 Price it with me — conversational line-item builder. Extracts scope
          + asks the judgment questions, then injects deterministic pre-filled
          lines into the options below for normal human review. */}
      <PriceItWithMe
        pricebook={opts}
        modifiers={modMap}
        optionNames={options.map((o) => o.name)}
        hcpJobId={initialJob?.hcpJobId ?? null}
        disabled={pending}
        onAddLines={addConversationLines}
      />

      {/* Auto-seed status — drafting good/better/best from the visit notes */}
      {seeding ? (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          ✨ Drafting good/better/best from the visit notes… (review everything before creating the estimate)
        </div>
      ) : null}
      {seedMsg ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{seedMsg}</div>
      ) : null}

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

                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <label className="block"><span className="text-xs font-medium text-neutral-600">Hours</span>
                    <input type="number" min="0" step="0.5" value={l.hours} onChange={(e) => updateLine(oi, li, { hours: e.target.value })} className={inputCls} /></label>
                  <label className="block"><span className="text-xs font-medium text-neutral-600">Crew</span>
                    <select value={l.crew} onChange={(e) => updateLine(oi, li, { crew: e.target.value })} className={inputCls}>
                      {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n} ({money(rateFor(n))}/hr)</option>)}
                    </select></label>
                  <label className="block"><span className="text-xs font-medium text-neutral-600">Materials $ (cost)</span>
                    <input type="number" min="0" step="1" value={l.materials} onChange={(e) => updateLine(oi, li, { materials: e.target.value })} className={inputCls} /></label>
                  <label className="block"><span className="text-xs font-medium text-neutral-600">Price $ (value-based — clear to use labor formula)</span>
                    <input type="number" min="0" step="1" value={l.priceOverride} onChange={(e) => updateLine(oi, li, { priceOverride: e.target.value })} placeholder="(uses formula)" className={inputCls} /></label>
                </div>

                {/* Approved-BOM materials hint — deterministic standard-materials
                    cost for this service (service_material_estimate RPC). A
                    suggestion the tech accepts; never auto-fills the Materials $. */}
                {l.item && l.item !== CUSTOM && bomHints[l.item] ? (() => {
                  const hint = bomHints[l.item]!;
                  return (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">
                      <span>📦 Standard materials for this: <span className="font-semibold">${hint.materials_cost_dollars.toFixed(2)}</span> ({hint.n_priced}/{hint.n_required} parts priced)</span>
                      <button type="button" onClick={() => updateLine(oi, li, { materials: String(hint.materials_cost_dollars) })}
                        title="Fill the Materials $ (cost) field with this standard cost — you can still edit it."
                        className="rounded border border-emerald-300 bg-white px-1.5 py-0.5 font-medium text-emerald-700 hover:bg-emerald-100">use</button>
                      {hint.coverage_pct < 100 && hint.unpriced_parts.length > 0 ? (
                        <span className="text-emerald-700/70">partial — {hint.unpriced_parts.slice(0, 2).join(", ")} not priced yet</span>
                      ) : null}
                    </div>
                  );
                })() : null}

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

                {chosenName(l) ? (() => {
                  const k = `${oi}-${li}`;
                  const term = (modSearch[k] ?? "").toLowerCase().trim();
                  const rec = new Set(recommendedKeys(l));
                  const matches = pickerMods
                    .filter((m) => !l.modifierKeys.includes(m.key))
                    .filter((m) => !term || m.name.toLowerCase().includes(term) || m.category.toLowerCase().includes(term))
                    .sort((a, b) => (rec.has(b.key) ? 1 : 0) - (rec.has(a.key) ? 1 : 0));
                  return (
                    <div className="mt-2 border-t border-dashed border-neutral-200 pt-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-medium text-neutral-500">Modifiers</span>
                        {l.modifierKeys.length === 0 ? <span className="text-[11px] text-neutral-400">none</span> : null}
                        {l.modifierKeys.map((mk) => modMap[mk] ? (
                          <span key={mk} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-800 ring-1 ring-inset ring-brand-200">
                            {modMap[mk].name} <span className="text-brand-500">{modEffectLabel(modMap[mk])}</span>
                            <button type="button" onClick={() => toggleMod(oi, li, mk)} className="ml-0.5 text-brand-400 hover:text-red-600" title="remove">×</button>
                          </span>
                        ) : null)}
                      </div>
                      <input value={modSearch[k] ?? ""} onChange={(e) => setModSearch((p) => ({ ...p, [k]: e.target.value }))}
                        placeholder="add a modifier — permit, gas, excavator, emergency…" className={inputCls + " mt-1"} />
                      {matches.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {matches.slice(0, term ? 16 : 6).map((m) => (
                            <button key={m.key} type="button" onClick={() => toggleMod(oi, li, m.key)}
                              className={"rounded-md border px-2 py-0.5 text-[11px] " + (rec.has(m.key) ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50")}>
                              {rec.has(m.key) ? "⭐ " : "+ "}{m.name} <span className="text-neutral-400">{modEffectLabel(m)}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })() : null}

                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  {l.priceOverride.trim() !== "" ? (
                    // Value-based price set — it's the sell price; show the
                    // cost-plus formula beneath it as the cost basis.
                    <span className="text-neutral-700">
                      <span className="font-semibold text-brand-700">{money(lineSellPrice(o, l))}</span> <span className="text-[11px] text-brand-500">value price</span>
                      <span className="ml-2 text-[11px] text-neutral-400">cost basis {money(linePrice(l))}</span>
                    </span>
                  ) : (
                    <span className="text-neutral-700">
                      Labor {money((parseFloat(l.hours) || 0) * rateFor(Math.max(1, Math.min(7, parseInt(l.crew) || 1))))} + materials {money(Math.max(0, parseFloat(l.materials) || 0) * 1.3)} (×1.3) ={" "}
                      {chosenName(l) && Math.round(lineModified(o, l)) !== Math.round(linePrice(l)) ? (
                        <><span className="text-neutral-400 line-through">{money(linePrice(l))}</span> <span className="font-semibold text-brand-700">{money(lineModified(o, l))}</span> <span className="text-[11px] text-brand-500">w/ modifiers</span></>
                      ) : (
                        <span className="font-semibold text-neutral-900">{money(linePrice(l))}</span>
                      )}
                    </span>
                  )}
                  {o.lines.length > 1 ? <button type="button" onClick={() => removeLine(oi, li)} className="ml-auto text-xs text-red-700 hover:text-red-900">× remove line</button> : null}
                </div>
              </div>
            );
          })}

          <button type="button" onClick={() => addLine(oi)} className="mt-1 text-xs font-medium text-brand-700 underline hover:text-brand-900">+ add line item to this option</button>

          {(() => {
            const extra = computeOption(o).extraLines;
            if (extra.length === 0) return null;
            return (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <span className="font-medium">Modifier charges on this option (added as their own lines):</span>
                <ul className="mt-1 space-y-0.5">
                  {extra.map((e) => (
                    <li key={e.modifierKey} className="flex items-center gap-2">
                      <span>{e.kind === "equipment" ? "🚜" : e.kind === "permit" ? "📋" : "🏷️"}</span>
                      <span>{e.name}</span>
                      <span className="ml-auto font-semibold">{money(e.price)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
        </div>
      ))}

      <button type="button" onClick={addOption} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
        + Add option
      </button>

      {/* Notes */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* "Private notes", not "HCP Pro Notes" (A5, 2026-07-16) — matches the
            estimate page's Private notes section. */}
        <label className="text-xs"><span className="mb-1 block font-medium text-neutral-600">Private note (never shown to the customer)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={inputCls} placeholder="Scope / internal context — for the crew and the office" /></label>
        <label className="text-xs">
          <span className="mb-1 flex flex-wrap items-center gap-2 font-medium text-neutral-600">
            Customer-facing message
            <button type="button" onClick={genWriteup} disabled={writeupBusy || !hasValid}
              title="Write the full estimate description in Danny's voice — Summary, Work Description, Notes (Claude Sonnet)."
              className="rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50">
              {writeupBusy ? "Writing…" : "✍️ Generate full write-up"}
            </button>
          </span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} className={inputCls}
            placeholder="Free-form prose shown to the customer above the options — or click ✍️ to draft it in Danny's voice (Summary / Work Description / Notes)" />
          {writeupErr ? <span className="mt-1 block text-red-700">{writeupErr}</span> : null}
        </label>
      </div>

      {/* Submit */}
      <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-4">
        <div className="text-sm text-neutral-600">Grand total (all options): <span className="text-base font-semibold text-neutral-900">{money(grandTotal)}</span></div>
        {hasValid ? (
          <button type="button" onClick={polishAll} disabled={polishing || pending}
            title="Rewrite every line's scope into a customer-facing description in Danny's voice (Claude Haiku). Review before creating the estimate."
            className="rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50">
            {polishing ? "Polishing…" : "✨ Polish all descriptions"}
          </button>
        ) : null}
        <button type="button" onClick={submit} disabled={pending || !hasValid} className="ml-auto rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300">
          {/* "Create estimate", not "Push to HCP" (Landon → Danny, 2026-07-16):
              the app IS where estimates get made; HCP is the synced system of record. */}
          {pending ? "Creating estimate…" : `Create estimate — ${options.length} option${options.length === 1 ? "" : "s"} →`}
        </button>
        {backHref ? <button type="button" onClick={() => router.push(backHref)} disabled={pending} className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">Cancel</button> : null}
      </div>
      {err ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div> : null}
      <p className="text-[10px] text-neutral-400">All options become one estimate the customer picks from (syncs to Housecall Pro; nothing sends until you choose). Materials marked up ×1.3, crew rates 185/250/+85, matching /estimate-draft + Add-line-item.</p>
    </div>
  );
}
