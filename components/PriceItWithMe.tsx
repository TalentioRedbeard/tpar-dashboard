"use client";

// 🧮 "Price it with me" — conversational line-item builder panel, mounted inside
// MultiOptionEstimateBuilder above the options. The tech describes the work in
// their own words → the estimate-from-conversation edge fn extracts scope items
// (grounded against the pricebook) + asks the judgment questions → "Build my
// line items" returns DETERMINISTIC proposed lines the tech injects into the
// normal 4-question form for review. Nothing prices itself into HCP — the
// injected lines go through the exact same human-reviewed submit path.
//
// Injection mapping (the load-bearing part): the builder's Q4 <select> value is
// the pricebook ITEM NAME (PriceItem.item), NOT price_book_id — so hydration
// works by matching the proposal's item/classification against the loaded
// pricebook rows and copying THAT row's exact q1/q2/q3/item strings. Anything
// that can't hydrate cleanly falls back to item='__custom__' with the sell
// price carried in priceOverride so the number survives.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  conversationExtract,
  conversationPropose,
  type ConversationTurn,
  type ConvQuestion,
  type ProposedFee,
  type ProposedLine,
  type ProposedOption,
  type ScopeChip,
} from "@/lib/line-item-conversation-actions";
import type { PriceItem } from "@/lib/job-line-actions";
import type { EstimateModifier } from "@/lib/multi-option-estimate-actions";
import { applyOptionModifiers, linePriceDollars, rateFor } from "@/lib/estimate-pricing";
import type { Line } from "./MultiOptionEstimateBuilder";

// Must match MultiOptionEstimateBuilder's CUSTOM sentinel ("Custom Plumbing
// Solution…" Q4 choice). Type-only Line import above keeps the module graph
// acyclic at runtime.
const CUSTOM = "__custom__";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
// Fee amounts can be negative (discounts) — show a leading minus, never "$-150".
const moneySigned = (n: number) => (n < 0 ? `−$${Math.round(-n).toLocaleString()}` : money(n));

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// Find the pricebook row a proposed line hydrates to. Match by item name
// (grounding's pricebook name first, then the display name), case-insensitive;
// prefer a row whose q1/q2/q3 also match the proposed classification. A unique
// name-only hit is trusted (we use ITS q1/q2/q3, guaranteeing the cascade
// selects hydrate); an ambiguous name with no classification match returns
// null → custom fallback.
function findPricebookMatch(p: ProposedLine, pricebook: PriceItem[]): PriceItem | null {
  const names = [norm(p.grounding.pricebookItemName), norm(p.itemName)].filter(Boolean);
  if (names.length === 0) return null;
  const byName = pricebook.filter((x) => names.includes(norm(x.item)));
  if (byName.length === 0) return null;
  const classified = byName.find(
    (x) => norm(x.q1) === norm(p.q1) && norm(x.q2) === norm(p.q2) && norm(x.q3) === norm(p.q3),
  );
  if (classified) return classified;
  return byName.length === 1 ? byName[0] : null;
}

// Map one proposed line → the builder's Line shape. Price rules (documented
// decisions — the goal is "never silently lose the price, never double-count"):
//  • all modifiers known to the builder's engine + engine math reproduces the
//    backend sell price (±$1, or the difference is an equipment/permit fee the
//    builder surfaces as its own transparent extra line) → priceOverride ''
//    (the live formula stays editable);
//  • otherwise the backend's sell price is carried in priceOverride (the
//    builder shows it as the value price with the formula as cost basis);
//  • unknown modifier keys are dropped from the injected line (the builder
//    can't render or compute them) — the price survives via the override.
function toBuilderLine(
  p: ProposedLine,
  pricebook: PriceItem[],
  defs: Record<string, EstimateModifier>,
): Line {
  const hours = String(Number.isFinite(p.laborHours) && p.laborHours >= 0 ? p.laborHours : 0);
  const crew = String(Math.max(1, Math.min(7, Math.round(p.crewSize) || 2)));
  const materials = String(Number.isFinite(p.materialsCostDollars) && p.materialsCostDollars >= 0 ? p.materialsCostDollars : 0);
  const sell = p.lineSellPriceDollars;
  const allKnown = p.modifiersApplied.every((k) => !!defs[k]);

  let modifierKeys: string[];
  let priceOverride: string;
  if (!allKnown) {
    modifierKeys = [];
    priceOverride = sell != null ? String(sell) : "";
  } else if (p.modifiersApplied.length === 0) {
    modifierKeys = [];
    priceOverride = sell != null && Math.abs(sell - linePriceDollars(hours, crew, materials)) > 1 ? String(sell) : "";
  } else {
    modifierKeys = [...p.modifiersApplied];
    if (sell == null) {
      priceOverride = "";
    } else {
      const r = applyOptionModifiers([{ hours, crew, materials, modifierKeys }], defs);
      const enginePrice = r.lines[0]?.price ?? 0;
      // Extra lines (equipment/permit) are the builder's own transparent
      // surface for those fees — if present, let the builder's math rule.
      priceOverride = r.extraLines.length === 0 && Math.abs(sell - enginePrice) > 1 ? String(sell) : "";
    }
  }

  const match = findPricebookMatch(p, pricebook);
  if (match) {
    return {
      q1: match.q1, q2: match.q2, q3: match.q3, item: match.item, customName: "",
      hours, crew, materials, description: p.description, modifierKeys, priceOverride,
    };
  }
  return {
    q1: "", q2: "", q3: "", item: CUSTOM,
    customName: (p.itemName || p.grounding.pricebookItemName || "Line item").trim().slice(0, 255),
    hours, crew, materials, description: p.description, modifierKeys, priceOverride,
  };
}

// Map an option-scoped fee → an editable builder line. The price rides in
// priceOverride (hours 0 / crew 1 / materials 0 would formula to $0 otherwise).
// NOTE: negative fees (discounts) must NOT go through this — the builder clamps
// priceOverride to ≥0 and HCP lines can't carry negative prices; the UI blocks
// them (see the fee row's disabled Add) so a discount is never silently zeroed.
function feeToBuilderLine(f: ProposedFee): Line {
  const kindWord = f.kind ? f.kind.charAt(0).toUpperCase() + f.kind.slice(1) + " fee" : "Option-level fee";
  return {
    q1: "", q2: "", q3: "", item: CUSTOM,
    customName: `Fee — ${f.name}`.slice(0, 255),
    hours: "0", crew: "1", materials: "0",
    description: `${kindWord} from the "Price it with me" proposal — charged once for this option.`,
    modifierKeys: [],
    priceOverride: String(f.amountDollars),
  };
}

function feeEmoji(kind: string): string {
  if (kind === "permit") return "📋";
  if (kind === "equipment") return "🚜";
  if (kind === "discount") return "🏷️";
  return "🧾";
}

// The price shown on a proposal card: the backend's deterministic number when
// present, else the builder's own formula (+known modifiers) — same math the
// injected line will show.
function cardPrice(p: ProposedLine, defs: Record<string, EstimateModifier>): number {
  if (p.lineSellPriceDollars != null) return p.lineSellPriceDollars;
  const known = p.modifiersApplied.filter((k) => !!defs[k]);
  if (known.length > 0) {
    const r = applyOptionModifiers(
      [{ hours: p.laborHours, crew: p.crewSize, materials: p.materialsCostDollars, modifierKeys: known }],
      defs,
    );
    return (r.lines[0]?.price ?? 0) + r.extraLines.reduce((s, e) => s + e.price, 0);
  }
  return linePriceDollars(p.laborHours, p.crewSize, p.materialsCostDollars);
}

// Grounding has three faces now: matched, ambiguous (backend sends the TOP
// CANDIDATE's price_book_id/pricebook_item_name — a best guess, not a match),
// and custom. Ambiguous hydration still tries the candidate (findPricebookMatch
// reads the same fields) but the badge stays honest about the uncertainty.
type GroundKind = "matched" | "ambiguous" | "custom";
const groundKind = (status: string, priceBookId: string | null): GroundKind =>
  status === "matched" ? "matched" : status === "ambiguous" ? "ambiguous" : priceBookId ? "matched" : "custom";

function GroundingBadge({ status, priceBookId }: { status: string; priceBookId: string | null }) {
  const kind = groundKind(status, priceBookId);
  if (kind === "matched") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200" title="Matched to a pricebook item">
        ✅ pricebook
      </span>
    );
  }
  if (kind === "ambiguous") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200" title="Ambiguous pricebook match — the best candidate is carried; double-check the item after adding">
        ≈ best match
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200" title="No pricebook match — will be added as a Custom line">
      ✳️ custom
    </span>
  );
}

export function PriceItWithMe({
  pricebook,
  modifiers,
  optionNames,
  hcpJobId,
  disabled,
  onAddLines,
}: {
  // The builder's loaded pricebook cascade rows (null while loading) — needed
  // to hydrate injected Q1–Q4 picks with the exact option strings.
  pricebook: PriceItem[] | null;
  // The builder's active modifier map (modMap) — for chip labels + reproducing
  // the deterministic price client-side.
  modifiers: Record<string, EstimateModifier>;
  // Current option names, in order — the "Add to Option …" target list.
  optionNames: string[];
  hcpJobId?: string | null;
  disabled?: boolean;
  onAddLines: (optionIndex: number, lines: Line[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "scoped" | "proposed">("idle");

  // The running conversation (every narration turn the tech has added).
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [narration, setNarration] = useState("");   // idle textarea
  const [moreText, setMoreText] = useState("");     // "add more detail" in scoped/proposed phases
  const [scopeStale, setScopeStale] = useState(false);

  const [chips, setChips] = useState<ScopeChip[]>([]);
  const [rawScopeItems, setRawScopeItems] = useState<unknown[]>([]);
  const [questions, setQuestions] = useState<ConvQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const qRefs = useRef<Array<HTMLInputElement | null>>([]);

  const [proposal, setProposal] = useState<ProposedOption[]>([]);
  const [target, setTarget] = useState(0);
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());

  const [extracting, startExtract] = useTransition();
  const [proposing, startPropose] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // Inline "added" notice (no toast lib in this app) — auto-clears.
  const [added, setAdded] = useState<string | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (addedTimer.current) clearTimeout(addedTimer.current); }, []);
  function notifyAdded(msg: string) {
    setAdded(msg);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAdded(null), 6000);
  }

  const targetIdx = Math.max(0, Math.min(target, optionNames.length - 1));
  const targetLabel = optionNames[targetIdx] || `Option ${targetIdx + 1}`;
  const busy = extracting || proposing;

  // Model-format failures are OUR problem, not the tech's — render a plain
  // retry line instead of "tool output malformed" (Landon, 7/16; the raw
  // error still lands in maintenance_logs server-side).
  const friendlyErr = (m: string) =>
    /malformed|tool-format|did not call/i.test(m)
      ? "The extractor stumbled on that one — hit Start again (it usually clears on retry). If it keeps failing, text the office."
      : m;

  function runExtract(conv: ConversationTurn[]) {
    setErr(null);
    startExtract(async () => {
      const res = await conversationExtract({ conversation: conv, hcpJobId: hcpJobId ?? undefined });
      if (!res.ok) { setErr(friendlyErr(res.error)); return; }
      setConversation(conv);
      setNarration("");
      setChips(res.scopeItems);
      setRawScopeItems(res.rawScopeItems);
      setQuestions(res.questions);
      // Keep answers the tech already typed for questions that survived the re-read.
      setAnswers((prev) => Object.fromEntries(res.questions.filter((q) => prev[q.id]).map((q) => [q.id, prev[q.id]])));
      setScopeStale(false);
      setPhase("scoped");
    });
  }

  function startConversation() {
    const text = narration.trim();
    if (!text || busy) return;
    runExtract([...conversation, { speaker: "tech", text }]);
  }

  // Append more narration to the conversation (no server round-trip — propose
  // sends the full conversation; a "re-read scope" refresh is offered).
  function addNarration() {
    const text = moreText.trim();
    if (!text) return;
    setConversation((c) => [...c, { speaker: "tech", text }]);
    setMoreText("");
    setScopeStale(true);
  }

  function buildLineItems() {
    if (busy) return;
    // Fold any un-appended narration in, so nothing typed gets lost.
    const extra = moreText.trim();
    const conv = extra ? [...conversation, { speaker: "tech" as const, text: extra }] : conversation;
    if (extra) { setConversation(conv); setMoreText(""); }
    const ansArr = questions
      .map((q) => ({ question_id: q.id, answer: (answers[q.id] ?? "").trim() }))
      .filter((a) => a.answer !== "");
    setErr(null);
    startPropose(async () => {
      const res = await conversationPropose({
        conversation: conv,
        answers: ansArr,
        scopeItems: rawScopeItems.length > 0 ? rawScopeItems : undefined,
      });
      if (!res.ok) { setErr(friendlyErr(res.error)); return; }
      setProposal(res.options);
      setAddedKeys(new Set());
      setPhase("proposed");
    });
  }

  const canAdd = !disabled && pricebook !== null;

  // Single injection path for proposed lines AND option fees (both arrive as
  // ready builder Lines).
  function inject(builderLines: Line[], keys: string[]) {
    if (!canAdd || builderLines.length === 0) return;
    onAddLines(targetIdx, builderLines);
    setAddedKeys((prev) => new Set([...prev, ...keys]));
    notifyAdded(`Added ${builderLines.length} line${builderLines.length === 1 ? "" : "s"} to ${targetLabel} — review the numbers before sending.`);
  }

  function addLines(lines: ProposedLine[], keys: string[]) {
    inject(lines.map((l) => toBuilderLine(l, pricebook ?? [], modifiers)), keys);
  }

  // "Add all" = every proposed line + every ADDABLE fee (positive amounts —
  // negative discounts can't ride a builder line; see feeToBuilderLine).
  function addAll(opt: ProposedOption, oi: number) {
    if (!canAdd) return;
    const builderLines: Line[] = [];
    const keys: string[] = [];
    opt.lineItems.forEach((l, li) => {
      builderLines.push(toBuilderLine(l, pricebook ?? [], modifiers));
      keys.push(`${oi}-${li}`);
    });
    opt.feeLines.forEach((f, fi) => {
      if (f.amountDollars > 0) {
        builderLines.push(feeToBuilderLine(f));
        keys.push(`fee-${oi}-${fi}`);
      }
    });
    inject(builderLines, keys);
  }

  function reset() {
    setPhase("idle");
    setConversation([]); setNarration(""); setMoreText(""); setScopeStale(false);
    setChips([]); setRawScopeItems([]); setQuestions([]); setAnswers({});
    setProposal([]); setAddedKeys(new Set()); setErr(null); setAdded(null);
  }

  const inputCls = "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  // Mapping preview per proposal line: which lines will land as Custom despite
  // a pricebook grounding (so the fallback is visible before adding).
  const fallbackNote = useMemo(() => {
    const out = new Set<string>();
    if (pricebook === null) return out;
    proposal.forEach((o, oi) => o.lineItems.forEach((l, li) => {
      if (groundKind(l.grounding.status, l.grounding.priceBookId) !== "custom" && !findPricebookMatch(l, pricebook)) {
        out.add(`${oi}-${li}`);
      }
    }));
    return out;
  }, [proposal, pricebook]);

  // ── Collapsed header ───────────────────────────────────────────────────────
  if (!open) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white">
        <button type="button" onClick={() => setOpen(true)} disabled={disabled}
          className="flex w-full items-center justify-between gap-2 rounded-2xl px-4 py-3 text-left hover:bg-brand-50/50 disabled:opacity-50">
          <span className="text-sm font-semibold text-neutral-900">
            🧮 Price it with me
            <span className="ml-2 font-normal text-neutral-500">— describe the work in your own words; I&apos;ll draft the line items</span>
          </span>
          <span className="text-xs text-brand-700">open ▾</span>
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-neutral-900">
          🧮 Price it with me
          <span className="ml-2 font-normal text-neutral-500">— talk it through; every number lands in the form below for your review</span>
        </div>
        <div className="flex items-center gap-3">
          {phase !== "idle" ? (
            <button type="button" onClick={reset} className="text-xs text-neutral-500 hover:text-neutral-800">start over</button>
          ) : null}
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-500 hover:text-neutral-800">close ▴</button>
        </div>
      </div>

      {/* a. Idle — first narration */}
      {phase === "idle" ? (
        <div>
          <textarea value={narration} onChange={(e) => setNarration(e.target.value)} rows={3}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); startConversation(); } }}
            placeholder={'e.g. "Pulling the old 40-gallon gas heater in the garage, setting a new Rheem, new pan and expansion tank, haul-off. Attic access is tight so probably two of us…"'}
            className={inputCls} />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={startConversation} disabled={busy || !narration.trim()}
              className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300">
              {extracting ? "Reading the scope…" : "Start →"}
            </button>
            <span className="text-[11px] text-neutral-500">I&apos;ll pull out the scope items, then ask you the judgment calls.</span>
          </div>
        </div>
      ) : null}

      {/* b. Scoped — chips + judgment questions + more narration */}
      {phase === "scoped" || phase === "proposed" ? (
        <div className="space-y-3">
          {/* Scope chips */}
          {chips.length > 0 ? (
            <div>
              <div className="mb-1 text-xs font-medium text-neutral-600">Scope I heard</div>
              <div className="flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span key={c.scopeItemId}
                    title={[c.groundingItemName ? `Pricebook: ${c.groundingItemName}` : null, [c.q1, c.q2, c.q3].filter(Boolean).join(" › ") || null, c.gapFlags.length > 0 ? `Gaps: ${c.gapFlags.join(", ")}` : null].filter(Boolean).join("\n")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-800">
                    <span className="font-medium">{c.name}</span>
                    <GroundingBadge status={c.groundingStatus} priceBookId={c.priceBookId} />
                    {c.sellPriceDollars != null ? <span className="text-[10px] text-neutral-500">ref {money(c.sellPriceDollars)}</span> : null}
                    {c.gapFlags.length > 0 ? <span className="text-[10px] text-amber-600" title={c.gapFlags.join(", ")}>⚠ {c.gapFlags.length}</span> : null}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Judgment questions */}
          {phase === "scoped" && questions.length > 0 ? (
            <div>
              <div className="mb-1 text-xs font-medium text-neutral-600">Your judgment calls <span className="font-normal text-neutral-400">(answer what you can — Enter for the next one)</span></div>
              <div className="space-y-1.5">
                {questions.map((qq, i) => {
                  const val = answers[qq.id] ?? "";
                  return (
                    <div key={qq.id} className="rounded-md border border-neutral-100 bg-neutral-50 px-2.5 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs text-neutral-800">{qq.text}</span>
                        {val.trim() ? <span className="text-xs text-emerald-600" title="answered">✓</span> : null}
                      </div>
                      <input
                        ref={(el) => { qRefs.current[i] = el; }}
                        value={val}
                        onChange={(e) => setAnswers((p) => ({ ...p, [qq.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); qRefs.current[i + 1]?.focus(); } }}
                        placeholder={qq.parameter ? `${qq.parameter}…` : "your call…"}
                        className={inputCls + " mt-1"} />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* More narration */}
          {phase === "scoped" ? (
            <div>
              <div className="mb-1 text-xs font-medium text-neutral-600">Anything else? <span className="font-normal text-neutral-400">(adds to the conversation)</span></div>
              <div className="flex gap-2">
                <input value={moreText} onChange={(e) => setMoreText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNarration(); } }}
                  placeholder="e.g. slab is post-tension, customer wants it done Saturday…" className={inputCls} />
                <button type="button" onClick={addNarration} disabled={!moreText.trim()}
                  className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">Add</button>
              </div>
              {scopeStale ? (
                <button type="button" onClick={() => runExtract(conversation)} disabled={busy}
                  className="mt-1.5 text-xs text-brand-700 underline hover:text-brand-900 disabled:opacity-50">
                  {extracting ? "Re-reading…" : "↻ Re-read the scope with what I added"}
                </button>
              ) : null}
            </div>
          ) : null}

          {/* c. Build */}
          {phase === "scoped" ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-3">
              <button type="button" onClick={buildLineItems} disabled={busy}
                className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300">
                {proposing ? "Pricing it…" : "Build my line items →"}
              </button>
              <span className="text-[11px] text-neutral-500">Deterministic pricebook math — nothing goes to the customer from here.</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* d. Proposed lines */}
      {phase === "proposed" ? (
        <div className="mt-3 space-y-3 border-t border-neutral-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-neutral-600">Add into:</span>
            <select value={targetIdx} onChange={(e) => setTarget(Number(e.target.value) || 0)}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs">
              {optionNames.map((n, i) => <option key={i} value={i}>{n || `Option ${i + 1}`}</option>)}
            </select>
            {pricebook === null ? <span className="text-[11px] text-neutral-400">(loading pricebook…)</span> : null}
            <button type="button" onClick={buildLineItems} disabled={busy}
              className="ml-auto text-xs text-brand-700 underline hover:text-brand-900 disabled:opacity-50"
              title="Re-run the pricing with the current answers/conversation.">
              {proposing ? "Re-pricing…" : "↻ Rebuild"}
            </button>
          </div>

          {proposal.map((opt, oi) => (
            <div key={oi}>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-neutral-800">{opt.optionLabel}</span>
                <span className="text-[11px] text-neutral-400">
                  {opt.lineItems.length} line{opt.lineItems.length === 1 ? "" : "s"}
                  {opt.feeLines.length > 0 ? ` · ${opt.feeLines.length} fee${opt.feeLines.length === 1 ? "" : "s"}` : ""}
                </span>
                {opt.subtotalDollars != null ? (
                  <span className="text-[11px] text-neutral-500">subtotal <span className="font-semibold text-neutral-700">{moneySigned(opt.subtotalDollars)}</span></span>
                ) : null}
                <button type="button" disabled={!canAdd}
                  onClick={() => addAll(opt, oi)}
                  className="rounded-md border border-brand-300 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">
                  Add all → {targetLabel}
                </button>
              </div>
              {opt.description ? <p className="mb-1.5 text-xs text-neutral-500">{opt.description}</p> : null}
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {opt.lineItems.map((l, li) => {
                  const key = `${oi}-${li}`;
                  const wasAdded = addedKeys.has(key);
                  const crew = Math.max(1, Math.min(7, Math.round(l.crewSize) || 2));
                  return (
                    <div key={key} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-neutral-900">{l.itemName}</span>
                        <GroundingBadge status={l.grounding.status} priceBookId={l.grounding.priceBookId} />
                      </div>
                      {l.description ? <p className="mt-1 text-xs text-neutral-600">{l.description}</p> : null}
                      <div className="mt-1.5 text-xs text-neutral-700">
                        {l.laborHours}h × crew {crew} <span className="text-neutral-400">({money(rateFor(crew))}/hr)</span>
                        {" · "}materials {money(l.materialsCostDollars)}
                      </div>
                      {l.modifiersApplied.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {l.modifiersApplied.map((mk) => (
                            <span key={mk} className={"rounded-full px-1.5 py-0.5 text-[10px] ring-1 ring-inset " + (modifiers[mk] ? "bg-brand-50 text-brand-800 ring-brand-200" : "bg-neutral-100 text-neutral-500 ring-neutral-200")}
                              title={modifiers[mk] ? modifiers[mk].name : `${mk} — not in this builder's modifier list; the price is carried as a value price instead`}>
                              {modifiers[mk]?.name ?? mk}{modifiers[mk] ? "" : " (?)"}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-sm font-semibold text-brand-700">{money(cardPrice(l, modifiers))}</span>
                        <span className="text-[10px] text-neutral-400">deterministic</span>
                        {fallbackNote.has(key) ? (
                          <span className="text-[10px] text-amber-600" title="The pricebook item couldn't be matched in this builder's cascade — it'll be added as a Custom line with the price carried.">→ adds as Custom</span>
                        ) : null}
                        <button type="button" disabled={!canAdd}
                          onClick={() => addLines([l], [key])}
                          className={"ml-auto rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50 " + (wasAdded ? "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-brand-700 text-white hover:bg-brand-800")}>
                          {wasAdded ? "✓ Added (again?)" : `+ Add to ${targetLabel}`}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Option-scoped fees — charged ONCE per option, NOT in any line's
                  price. Rendered as distinct rows (not line cards) so they read
                  as what they are; each is addable as an editable builder line. */}
              {opt.feeLines.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {opt.feeLines.map((f, fi) => {
                    const feeKey = `fee-${oi}-${fi}`;
                    const feeAdded = addedKeys.has(feeKey);
                    const addable = f.amountDollars > 0;
                    return (
                      <div key={feeKey} className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-amber-300 bg-amber-50/70 px-3 py-1.5 text-xs text-amber-900">
                        <span>{feeEmoji(f.kind)}</span>
                        <span>
                          <span className="font-medium">Option fee — {f.name}</span>
                          {" · "}<span className="font-semibold">{moneySigned(f.amountDollars)}</span>
                          {" "}<span className="text-amber-700">(charged once per option)</span>
                        </span>
                        <button type="button" disabled={!canAdd || !addable}
                          onClick={() => inject([feeToBuilderLine(f)], [feeKey])}
                          title={addable
                            ? "Adds this fee as its own editable line (price carried as a value price)."
                            : "Negative amounts (discounts) can't ride an estimate line — apply a discount modifier or handle it in HCP."}
                          className={"ml-auto rounded-md px-2.5 py-1 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-50 " + (feeAdded ? "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border border-amber-400 bg-white text-amber-900 hover:bg-amber-100")}>
                          {feeAdded ? "✓ Added (again?)" : `+ Add to ${targetLabel}`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {/* Money-drop guard: lines were added piecemeal but this option's
                  fees weren't — nudge before the fee silently goes missing. */}
              {(() => {
                if (opt.feeLines.length === 0) return null;
                const anyLineAdded = opt.lineItems.some((_, li) => addedKeys.has(`${oi}-${li}`));
                const missing = opt.feeLines.filter((_, fi) => !addedKeys.has(`fee-${oi}-${fi}`)).length;
                if (!anyLineAdded || missing === 0) return null;
                return (
                  <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
                    ⚠ This option also carried {missing} fee{missing === 1 ? "" : "s"} — add them or price them via modifiers.
                  </div>
                );
              })()}
            </div>
          ))}

          {/* e. Human-in-the-loop notice */}
          {added ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              ✓ {added}
            </div>
          ) : null}
        </div>
      ) : null}

      {err ? <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div> : null}
    </div>
  );
}
