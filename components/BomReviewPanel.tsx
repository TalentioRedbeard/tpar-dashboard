"use client";

// /bom — Service → Parts (bill of materials) review surface. An LLM/heuristic
// generator drafts BOMs (service_boms pending + service_bom_lines); the owner
// reviews each: sees the deterministic materials rollup (service_material_estimate
// RPC — trust its numbers), edits lines (add / remove / match-to-catalog), then
// approves or rejects. Approved BOMs feed the estimate builder's materials hint.
//
// All the pricing numbers here are computed server-side by the RPC and passed
// down read-only; this component only edits the BOM *definition* (lines) and the
// approve/reject status. Owner-gated at the page + in every action.

import { useState, useTransition } from "react";
import {
  approveBom,
  rejectBom,
  addBomLine,
  removeBomLine,
  matchBomLine,
  searchCanonicalItems,
  type CanonicalHit,
} from "@/app/bom/actions";

export type BomEstLine = {
  id: string;
  part_name: string;
  qty: number;
  optional: boolean;
  note: string | null;
  canonical_item_id: number | null;
  matched: boolean;
  priced: boolean;
  unit_dollars: number | null;
  line_dollars: number | null;
  best_vendor: string | null;
};

export type BomCard = {
  id: string;
  service_key: string;
  service_label: string;
  q2_category: string | null;
  q3_work_type: string | null;
  status: string;
  basis: string;
  model: string | null;
  notes: string | null;
  lines: BomEstLine[];
  materials_cost_dollars: number;
  optional_cost_dollars: number;
  coverage_pct: number;
  n_lines: number;
  n_required: number;
  n_priced: number;
};

export type CategoryGroup = { category: string; boms: BomCard[] };
export type DemandRow = { part_name: string; service_count: number; line_count: number };

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

function readout(b: Pick<BomCard, "materials_cost_dollars" | "n_lines" | "n_priced" | "coverage_pct">): string {
  return `${money(b.materials_cost_dollars)} · ${b.n_lines} part${b.n_lines === 1 ? "" : "s"}, ${b.n_priced} priced (${b.coverage_pct}%)`;
}

// ── Catalog search picker (shared by add-line + per-line match) ─────────────
function CanonicalPicker({
  onPick,
  onCancel,
  compact,
}: {
  onPick: (hit: CanonicalHit) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CanonicalHit[] | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    const t = q.trim();
    if (t.length < 2) { setHits([]); return; }
    start(async () => { setHits(await searchCanonicalItems(t)); });
  };

  return (
    <div className={compact ? "mt-1" : "mt-2"}>
      <div className="flex items-center gap-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); run(); } }}
          placeholder="Search catalog by name…"
          autoFocus
          className="min-w-0 flex-1 rounded-md border border-navy-900/15 bg-white px-2 py-1 text-xs text-navy-900 placeholder:text-navy-900/40 focus:border-gold-500/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={run}
          disabled={pending || q.trim().length < 2}
          className="rounded-md border border-navy-900/15 bg-white px-2 py-1 text-xs font-medium text-navy-900 transition hover:bg-navy-900/[0.04] disabled:opacity-50"
        >
          {pending ? "…" : "Find"}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="text-xs text-navy-900/50 hover:text-navy-900">×</button>
        ) : null}
      </div>
      {hits !== null ? (
        hits.length === 0 ? (
          <p className="mt-1 text-[11px] text-navy-900/50">No catalog matches.</p>
        ) : (
          <ul className="mt-1 max-h-44 space-y-0.5 overflow-y-auto">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => onPick(h)}
                  className="w-full rounded-md border border-navy-900/10 bg-white px-2 py-1 text-left text-xs hover:border-gold-500/50 hover:bg-gold-500/[0.06]"
                >
                  <span className="font-medium text-navy-900">{h.canonical_name}</span>
                  {h.size ? <span className="ml-1 text-navy-900/50">{h.size}</span> : null}
                  {h.category ? <span className="ml-1 text-navy-900/40">· {h.category}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

// ── One editable line ───────────────────────────────────────────────────────
function LineRow({ line, editable }: { line: BomEstLine; editable: boolean }) {
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const doRemove = () => {
    setError(null);
    start(async () => { const r = await removeBomLine(line.id); if (!r.ok) setError(r.error); });
  };
  const doMatch = (canonicalItemId: number | null) => {
    setError(null);
    start(async () => {
      const r = await matchBomLine(line.id, canonicalItemId);
      if (!r.ok) setError(r.error); else setMatching(false);
    });
  };

  return (
    <li className="rounded-md border border-navy-900/10 bg-white px-2.5 py-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-navy-900">{line.part_name}</span>
        <span className="text-xs text-navy-900/55">× {line.qty}</span>
        {line.optional ? (
          <span className="rounded-full bg-navy-900/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-navy-900/55">optional</span>
        ) : null}
        {line.matched ? (
          <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200" title={`catalog #${line.canonical_item_id}`}>
            ✅ matched
          </span>
        ) : (
          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">✳️ unmatched</span>
        )}
        {line.matched && line.priced && line.unit_dollars != null ? (
          <span className="text-xs text-navy-900/70">
            {money(line.unit_dollars)}/ea{line.qty !== 1 && line.line_dollars != null ? <> · <span className="font-semibold text-navy-900">{money(line.line_dollars)}</span></> : null}
            {line.best_vendor ? <span className="ml-1 text-[10px] text-navy-900/40">{line.best_vendor}</span> : null}
          </span>
        ) : line.matched && !line.priced ? (
          <span className="text-[11px] text-navy-900/40">matched · no price yet</span>
        ) : null}

        {editable ? (
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMatching((v) => !v)}
              disabled={pending}
              className="text-[11px] font-medium text-navy-900/55 underline decoration-navy-900/30 underline-offset-2 hover:text-navy-900 disabled:opacity-50"
            >
              {line.matched ? "rematch" : "match"}
            </button>
            {line.matched ? (
              <button type="button" onClick={() => doMatch(null)} disabled={pending} className="text-[11px] text-navy-900/45 hover:text-navy-900 disabled:opacity-50">
                unmatch
              </button>
            ) : null}
            <button type="button" onClick={doRemove} disabled={pending} className="text-[11px] text-red-700 hover:text-red-900 disabled:opacity-50">
              remove
            </button>
          </span>
        ) : null}
      </div>
      {line.note ? <p className="mt-0.5 text-[11px] italic text-navy-900/50">{line.note}</p> : null}
      {matching ? (
        <CanonicalPicker compact onPick={(h) => doMatch(h.id)} onCancel={() => setMatching(false)} />
      ) : null}
      {error ? <p className="mt-1 text-[11px] text-red-700">{error}</p> : null}
    </li>
  );
}

// ── Add-line form ───────────────────────────────────────────────────────────
function AddLineForm({ bomId }: { bomId: string }) {
  const [open, setOpen] = useState(false);
  const [partName, setPartName] = useState("");
  const [qty, setQty] = useState("1");
  const [optional, setOptional] = useState(false);
  const [picked, setPicked] = useState<CanonicalHit | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => { setPartName(""); setQty("1"); setOptional(false); setPicked(null); setShowPicker(false); setError(null); };

  const submit = () => {
    setError(null);
    const n = Number(qty);
    if (!partName.trim()) { setError("Part name is required."); return; }
    if (!Number.isFinite(n) || n <= 0) { setError("Quantity must be greater than 0."); return; }
    start(async () => {
      const r = await addBomLine({ bomId, partName: partName.trim(), qty: n, optional, canonicalItemId: picked?.id ?? null });
      if (!r.ok) setError(r.error);
      else { reset(); setOpen(false); }
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 text-xs font-medium text-navy-900/70 underline decoration-gold-500/50 underline-offset-2 hover:text-navy-900">
        + add part
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-navy-900/10 bg-navy-900/[0.02] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={partName}
          onChange={(e) => setPartName(e.target.value)}
          placeholder="Part name (e.g. wax ring)"
          className="min-w-[180px] flex-1 rounded-md border border-navy-900/15 bg-white px-2 py-1 text-xs text-navy-900 placeholder:text-navy-900/40 focus:border-gold-500/60 focus:outline-none"
        />
        <label className="flex items-center gap-1 text-xs text-navy-900/70">
          qty
          <input type="number" min="0.01" step="0.5" value={qty} onChange={(e) => setQty(e.target.value)} className="w-16 rounded-md border border-navy-900/15 bg-white px-1.5 py-1 text-xs" />
        </label>
        <label className="flex items-center gap-1 text-xs text-navy-900/70">
          <input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} />
          optional
        </label>
      </div>
      <div className="text-xs text-navy-900/70">
        {picked ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 ring-1 ring-inset ring-emerald-200">
            ✅ {picked.canonical_name}
            <button type="button" onClick={() => setPicked(null)} className="text-emerald-500 hover:text-red-600">×</button>
          </span>
        ) : showPicker ? (
          <CanonicalPicker compact onPick={(h) => { setPicked(h); setShowPicker(false); }} onCancel={() => setShowPicker(false)} />
        ) : (
          <button type="button" onClick={() => setShowPicker(true)} className="text-[11px] font-medium text-navy-900/55 underline decoration-navy-900/30 underline-offset-2 hover:text-navy-900">
            match to catalog (optional)
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={submit} disabled={pending} className="rounded-md bg-navy-900 px-3 py-1 text-xs font-semibold text-white transition hover:bg-navy-800 disabled:opacity-60">
          {pending ? "Adding…" : "Add part"}
        </button>
        <button type="button" onClick={() => { reset(); setOpen(false); }} disabled={pending} className="text-xs text-navy-900/50 hover:text-navy-900">Cancel</button>
        {error ? <span className="text-[11px] text-red-700">{error}</span> : null}
      </div>
    </div>
  );
}

// ── Pending BOM card (full editor) ──────────────────────────────────────────
function PendingBomCard({ bom }: { bom: BomCard }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const decide = (fn: (id: string) => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => { const r = await fn(bom.id); if (!r.ok) setError(r.error ?? "failed"); });
  };

  return (
    <li className="space-y-2 rounded-lg border border-gold-500/30 bg-gold-500/[0.05] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-navy-900">{bom.service_label}</p>
          <p className="text-[11px] text-navy-900/50">
            {[bom.q2_category, bom.q3_work_type].filter(Boolean).join(" · ") || bom.service_key}
            {bom.model ? <span className="ml-1 text-navy-900/40">· {bom.basis}/{bom.model}</span> : bom.basis ? <span className="ml-1 text-navy-900/40">· {bom.basis}</span> : null}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-navy-900/70 ring-1 ring-inset ring-navy-900/10">
          {readout(bom)}
        </span>
      </div>

      {bom.notes ? <p className="text-xs italic text-navy-900/55">{bom.notes}</p> : null}

      {bom.lines.length === 0 ? (
        <p className="text-xs text-navy-900/45">No parts yet — add the parts this service consumes.</p>
      ) : (
        <ul className="space-y-1">
          {bom.lines.map((l) => <LineRow key={l.id} line={l} editable />)}
        </ul>
      )}

      <AddLineForm bomId={bom.id} />

      <div className="flex items-center gap-2 border-t border-navy-900/10 pt-2">
        <button type="button" onClick={() => decide(approveBom)} disabled={pending} className="rounded-md bg-navy-900 px-3 py-1 text-xs font-semibold text-white transition hover:bg-navy-800 disabled:opacity-60">
          {pending ? "…" : "Approve"}
        </button>
        <button type="button" onClick={() => decide(rejectBom)} disabled={pending} className="rounded-md border border-navy-900/15 bg-white px-2.5 py-1 text-xs font-medium text-navy-900/60 transition hover:bg-navy-900/[0.04] disabled:opacity-60">
          Reject
        </button>
        {error ? <span className="text-[11px] text-red-700">{error}</span> : null}
      </div>
    </li>
  );
}

// ── Approved BOM row (collapsed, read-only readout + lines) ──────────────────
function ApprovedBomRow({ bom }: { bom: BomCard }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const reopen = () => {
    setError(null);
    start(async () => { const r = await rejectBom(bom.id); if (!r.ok) setError(r.error); });
  };
  return (
    <details className="rounded-md border border-navy-900/10 bg-white">
      <summary className="flex cursor-pointer select-none flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span className="font-medium text-navy-900">{bom.service_label}</span>
        <span className="text-[11px] text-navy-900/45">{[bom.q2_category, bom.q3_work_type].filter(Boolean).join(" · ")}</span>
        <span className="ml-auto text-xs text-navy-900/70">{readout(bom)}</span>
      </summary>
      <div className="space-y-2 border-t border-navy-900/10 px-3 py-2">
        {bom.lines.length === 0 ? (
          <p className="text-xs text-navy-900/45">No parts.</p>
        ) : (
          <ul className="space-y-1">
            {bom.lines.map((l) => <LineRow key={l.id} line={l} editable={false} />)}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <button type="button" onClick={reopen} disabled={pending} className="text-[11px] font-medium text-navy-900/50 underline decoration-navy-900/30 underline-offset-2 hover:text-navy-900 disabled:opacity-50">
            {pending ? "…" : "reject (unlock to edit)"}
          </button>
          {error ? <span className="text-[11px] text-red-700">{error}</span> : null}
        </div>
      </div>
    </details>
  );
}

// ── Catalog demand strip ────────────────────────────────────────────────────
function CatalogDemandStrip({ demand }: { demand: DemandRow[] }) {
  if (demand.length === 0) return null;
  return (
    <section className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div>
        <h2 className="text-sm font-semibold text-amber-900">Catalog demand — the pricing backlog</h2>
        <p className="text-xs text-amber-800/80">
          The parts BOM lines call for most that aren&apos;t in the catalog yet. Seed + price these to lift coverage across the board.
        </p>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {demand.map((d) => (
          <li key={d.part_name} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs ring-1 ring-inset ring-amber-200">
            <span className="font-medium text-amber-900">{d.part_name}</span>
            <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800" title={`needed by ${d.service_count} service${d.service_count === 1 ? "" : "s"}`}>
              {d.service_count}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Top-level panel ─────────────────────────────────────────────────────────
export function BomReviewPanel({
  pendingGroups,
  approved,
  demand,
  stats,
  loadError,
}: {
  pendingGroups: CategoryGroup[];
  approved: BomCard[];
  demand: DemandRow[];
  stats: { approved: number; pending: number; priced: number };
  loadError: string | null;
}) {
  const pendingTotal = pendingGroups.reduce((n, g) => n + g.boms.length, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-navy-900">🔧 Service → Parts (bill of materials)</h1>
        <p className="mt-1 text-sm text-navy-900/60">
          {stats.approved} approved · {stats.pending} pending · {stats.priced} service{stats.priced === 1 ? "" : "s"} with a priced estimate
        </p>
      </header>

      {loadError ? <p className="text-sm text-red-700">Couldn&apos;t load BOMs: {loadError}</p> : null}

      <CatalogDemandStrip demand={demand} />

      <section className="space-y-5 rounded-lg border border-navy-900/10 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-navy-900">Pending review</h2>
            <p className="text-xs text-navy-900/60">
              Drafted BOMs waiting on you — check the parts, match anything unmatched, then approve. Approved BOMs feed the estimate builder&apos;s materials hint.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-navy-900/[0.05] px-2.5 py-1 text-xs font-medium text-navy-900/70">{pendingTotal} pending</span>
        </div>

        {pendingTotal === 0 ? (
          <p className="text-sm text-navy-900/50">Nothing waiting on review — the generator hasn&apos;t drafted any pending BOMs, or they&apos;re all reviewed.</p>
        ) : (
          <div className="space-y-5">
            {pendingGroups.map((g) => (
              <div key={g.category} className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-navy-900/70">{g.category}</h3>
                  <span className="text-[11px] text-navy-900/40">{g.boms.length}</span>
                </div>
                <ul className="space-y-2">
                  {g.boms.map((b) => <PendingBomCard key={b.id} bom={b} />)}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <details className="rounded-lg border border-navy-900/10 bg-white p-5 shadow-sm" open={pendingTotal === 0 && approved.length > 0}>
        <summary className="cursor-pointer select-none text-sm font-semibold text-navy-900">
          Approved <span className="font-normal text-navy-900/50">({approved.length})</span>
        </summary>
        {approved.length === 0 ? (
          <p className="mt-3 text-sm text-navy-900/50">No approved BOMs yet.</p>
        ) : (
          <div className="mt-3 space-y-1.5">
            {approved.map((b) => <ApprovedBomRow key={b.id} bom={b} />)}
          </div>
        )}
      </details>
    </div>
  );
}
