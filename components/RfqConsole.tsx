"use client";

// Parts bid / RFQ console (2026-06-18). Build a bid request from open needs (+ free-text parts),
// set urgency, pick suppliers, then one-tap a prefilled order email per supplier (mailto). Log
// each supplier's bid back and compare on price + delivery; award the winner. Sending email
// server-side + a live-status link is a later phase.

import { useState, useTransition } from "react";
import {
  createRfq, logBid, awardRfq, closeRfq, listRfqs,
  type Rfq, type RfqLine, type SupplierTarget,
} from "../app/shopping/rfq-actions";

type Need = { id: string; item: string; qty: number | null; urgency: string };

const URG: Array<[string, string]> = [["asap", "ASAP"], ["today", "Today"], ["this_week", "This week"], ["this_month", "This month"], ["no_rush", "No rush"]];
const urgLabel = (u: string) => URG.find(([v]) => v === u)?.[1] ?? u;
const money = (c: number | null) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);
const dollarsToCents = (s: string) => { const v = parseFloat(s); return Number.isFinite(v) ? Math.round(v * 100) : null; };

function bidMailto(rfq: Rfq, email: string, name: string, fromName: string): string {
  const items = rfq.lines.map((l) => `- ${l.qty ? `${l.qty}× ` : ""}${l.item}`).join("\n");
  const subject = `TPAR parts request — ${urgLabel(rfq.urgency)} (${rfq.lines.length} item${rfq.lines.length === 1 ? "" : "s"})`;
  const body =
    `Hi ${name},\n\nTulsa Plumbing & Remodeling would like a quote on the parts below. We award by best price + fastest delivery (free delivery preferred).\n\n` +
    `Urgency: ${urgLabel(rfq.urgency)}\n\n${items}\n\n` +
    (rfq.note ? `${rfq.note}\n\n` : "") +
    `Please reply with your price (per line or a total), whether you can deliver, your lead time, and any delivery fee.\n\nThanks!\n— ${fromName}, Tulsa Plumbing & Remodeling`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ── Bid logging + comparison for one RFQ ─────────────────────────────────────
function RfqCard({ rfq, fromName, onChange }: { rfq: Rfq; fromName: string; onChange: () => void }) {
  const [open, setOpen] = useState(rfq.status === "open");
  const [busy, start] = useTransition();
  const [vendor, setVendor] = useState("");
  const [total, setTotal] = useState("");
  const [days, setDays] = useState("");
  const [fee, setFee] = useState("");
  const [free, setFree] = useState(false);
  const [notes, setNotes] = useState("");

  function submitBid() {
    const distributor = vendor.trim();
    if (!distributor) return;
    start(async () => {
      const res = await logBid({
        rfqId: rfq.id, distributor, total_cents: dollarsToCents(total),
        delivery_days: days ? parseInt(days, 10) : null,
        delivery_fee_cents: free ? 0 : dollarsToCents(fee), free_delivery: free || (dollarsToCents(fee) === 0),
        notes,
      });
      if (res.ok) { setVendor(""); setTotal(""); setDays(""); setFee(""); setFree(false); setNotes(""); onChange(); }
    });
  }
  const award = (bidId: number, dist: string) => start(async () => { const r = await awardRfq(rfq.id, bidId, dist); if (r.ok) onChange(); });
  const close = () => start(async () => { const r = await closeRfq(rfq.id); if (r.ok) onChange(); });

  const ranked = [...rfq.bids].sort((a, b) => (a.total_cents ?? 9e9) - (b.total_cents ?? 9e9));

  return (
    <li className={`rounded-2xl border bg-white p-4 ${rfq.status === "awarded" ? "border-emerald-300" : "border-neutral-200"} ${busy ? "opacity-60" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
        <span>
          <span className="font-semibold text-neutral-900">{rfq.title || `${rfq.lines.length} part${rfq.lines.length === 1 ? "" : "s"}`}</span>
          <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${rfq.urgency === "asap" ? "bg-red-100 text-red-700" : rfq.urgency === "today" ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-600"}`}>{urgLabel(rfq.urgency)}</span>
          <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${rfq.status === "awarded" ? "bg-emerald-100 text-emerald-800" : rfq.status === "closed" ? "bg-neutral-100 text-neutral-500" : "bg-brand-100 text-brand-800"}`}>{rfq.status}{rfq.awarded_distributor ? ` · ${rfq.awarded_distributor}` : ""}</span>
        </span>
        <span className="text-xs text-neutral-400">{rfq.bids.length} bid{rfq.bids.length === 1 ? "" : "s"} · {open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          <ul className="rounded-lg bg-neutral-50 p-2 text-sm text-neutral-700">
            {rfq.lines.map((l, i) => <li key={i}>• {l.qty ? `${l.qty}× ` : ""}{l.item}</li>)}
          </ul>

          {rfq.suppliers.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Email the bid request</p>
              <div className="flex flex-wrap gap-1.5">
                {rfq.suppliers.map((s, i) => s.order_email ? (
                  <a key={i} href={bidMailto(rfq, s.order_email, s.name, fromName)}
                    className="rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100">✉ {s.name}</a>
                ) : (
                  <span key={i} className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs text-neutral-400" title="no order email on file">{s.name} (no email)</span>
                ))}
              </div>
            </div>
          ) : null}

          {ranked.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-neutral-200">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs text-neutral-500">
                  <tr><th className="px-2 py-1 text-left">Supplier</th><th className="px-2 py-1 text-right">Total</th><th className="px-2 py-1 text-left">Delivery</th><th className="px-2 py-1"></th></tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {ranked.map((b, i) => (
                    <tr key={b.id} className={b.status === "awarded" ? "bg-emerald-50" : ""}>
                      <td className="px-2 py-1 font-medium text-neutral-900">{b.distributor}{i === 0 && b.total_cents != null ? <span className="ml-1 rounded bg-emerald-600 px-1 text-[10px] text-white">low</span> : null}</td>
                      <td className="px-2 py-1 text-right font-mono">{money(b.total_cents)}</td>
                      <td className="px-2 py-1 text-xs text-neutral-600">{b.free_delivery ? "free" : b.delivery_fee_cents != null ? money(b.delivery_fee_cents) : "—"}{b.delivery_days != null ? ` · ${b.delivery_days === 0 ? "same-day" : b.delivery_days + "d"}` : ""}{b.notes ? ` · ${b.notes}` : ""}</td>
                      <td className="px-2 py-1 text-right">
                        {rfq.status !== "awarded" ? <button type="button" onClick={() => award(b.id, b.distributor)} disabled={busy} className="rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50">award</button> : b.status === "awarded" ? <span className="text-xs font-semibold text-emerald-700">✓ awarded</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {rfq.status !== "closed" ? (
            <div className="rounded-lg border border-neutral-200 p-2">
              <p className="mb-1 text-xs font-medium text-neutral-600">Log a bid</p>
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <input value={vendor} onChange={(e) => setVendor(e.target.value)} list={`sup-${rfq.id}`} placeholder="supplier" className="w-32 rounded border border-neutral-300 px-2 py-1 text-xs" />
                <datalist id={`sup-${rfq.id}`}>{rfq.suppliers.map((s, i) => <option key={i} value={s.name} />)}</datalist>
                <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="$ total" className="w-20 rounded border border-neutral-300 px-2 py-1 text-xs" />
                <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" placeholder="days" className="w-16 rounded border border-neutral-300 px-2 py-1 text-xs" />
                <input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" placeholder="$ deliv" disabled={free} className="w-20 rounded border border-neutral-300 px-2 py-1 text-xs disabled:bg-neutral-100" />
                <label className="flex items-center gap-1 text-xs text-neutral-600"><input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} className="h-3.5 w-3.5 accent-brand-600" />free</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="notes" className="w-28 rounded border border-neutral-300 px-2 py-1 text-xs" />
                <button type="button" onClick={submitBid} disabled={busy || !vendor.trim()} className="rounded bg-brand-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:bg-neutral-300">Log</button>
              </div>
            </div>
          ) : null}

          {rfq.status === "open" ? <button type="button" onClick={close} disabled={busy} className="text-xs text-neutral-400 hover:text-neutral-600 hover:underline">close request</button> : null}
        </div>
      ) : null}
    </li>
  );
}

export function RfqConsole({ openNeeds, suppliers, initialRfqs, fromName }: {
  openNeeds: Need[]; suppliers: SupplierTarget[]; initialRfqs: Rfq[]; fromName: string;
}) {
  const [rfqs, setRfqs] = useState(initialRfqs);
  const [building, setBuilding] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState("");
  const [urgency, setUrgency] = useState("this_week");
  const [supPicked, setSupPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const refresh = () => start(async () => setRfqs(await listRfqs()));

  function create() {
    setErr(null);
    const lines: RfqLine[] = openNeeds.filter((nd) => picked.has(nd.id)).map((nd) => ({ qty: nd.qty, item: nd.item, need_id: nd.id }));
    for (const raw of extra.split("\n").map((s) => s.trim()).filter(Boolean)) lines.push({ qty: null, item: raw });
    if (!lines.length) { setErr("Pick at least one part (or type some in)."); return; }
    if (!supPicked.size) { setErr("Pick at least one supplier to ask."); return; }
    start(async () => {
      const res = await createRfq({ urgency, note, lines, supplierIds: [...supPicked] });
      if (res.ok) { setPicked(new Set()); setExtra(""); setNote(""); setSupPicked(new Set()); setBuilding(false); setRfqs(await listRfqs()); }
      else setErr(res.error);
    });
  }

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); setter(n); };

  return (
    <div className="space-y-4">
      {!building ? (
        <button type="button" onClick={() => setBuilding(true)} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">+ New bid request</button>
      ) : (
        <div className="space-y-3 rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Parts {picked.size > 0 ? `(${picked.size} from needs)` : ""}</p>
            {openNeeds.length > 0 ? (
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">
                {openNeeds.map((nd) => (
                  <button key={nd.id} type="button" onClick={() => toggle(picked, setPicked, nd.id)}
                    className={`rounded-md border px-2 py-1 text-xs ${picked.has(nd.id) ? "border-brand-500 bg-brand-100 text-brand-900" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"}`}>
                    {nd.qty ? `${nd.qty}× ` : ""}{nd.item}
                  </button>
                ))}
              </div>
            ) : <p className="text-xs text-neutral-400">No open needs — type parts below.</p>}
            <textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={2} placeholder="…or type parts, one per line (e.g. 10× 3/4 brass tee)" className="mt-2 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-neutral-600">Urgency
              <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className="ml-1 rounded border border-neutral-300 px-2 py-1 text-sm">{URG.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Ask these suppliers to bid</p>
            <div className="flex flex-wrap gap-1.5">
              {suppliers.map((s) => (
                <button key={s.id} type="button" onClick={() => toggle(supPicked, setSupPicked, s.id)} disabled={!s.order_email}
                  title={s.order_email ?? "no order email on file"}
                  className={`rounded-md border px-2 py-1 text-xs ${!s.order_email ? "border-neutral-200 text-neutral-300" : supPicked.has(s.id) ? "border-brand-500 bg-brand-100 text-brand-900" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"}`}>
                  {s.name}{!s.order_email ? " ✉✗" : ""}
                </button>
              ))}
            </div>
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note for the supplier (optional)" className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm" />
          {err ? <p className="text-xs text-red-600">{err}</p> : null}
          <div className="flex gap-2">
            <button type="button" onClick={create} disabled={busy} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:bg-neutral-300">Create request</button>
            <button type="button" onClick={() => { setBuilding(false); setErr(null); }} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50">Cancel</button>
          </div>
          <p className="text-[11px] text-neutral-500">Creating it saves the request and gives you a one-tap order email per supplier (opens your mail app). Log their replies below to compare and award.</p>
        </div>
      )}

      {rfqs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">No bid requests yet.</p>
      ) : (
        <ul className="space-y-2">{rfqs.map((r) => <RfqCard key={r.id} rfq={r} fromName={fromName} onChange={refresh} />)}</ul>
      )}
    </div>
  );
}
