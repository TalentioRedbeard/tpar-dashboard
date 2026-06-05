// Inventory Phase 2c — deterministic matcher backfill over receipt_extractions.
// For each extracted receipt line: resolve the distributor, pull the vendor SKU
// (leading token), match it against inv_vendor_skus (exact). Hit -> link the
// known item. Miss -> harvest a candidate vendor_sku (the self-feeding loop).
// Either way, record a price observation in inv_vendor_prices. Deterministic
// only (exact SKU); the trigram + Claude tail + categorization is the next slice.
// Idempotent: clears its own prior output (source='receipt'). Run from dashboard dir.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
} catch {}
const SUPA_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error("missing supabase env"); process.exit(1); }
const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

const norm = (s) => (s || "").toLowerCase()
  .replace(/['’]/g, "")
  .replace(/[^a-z0-9 ]+/g, " ").replace(/[0-9]+/g, " ").replace(/\s+/g, " ").trim();
const cents = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : null; };
const skuOf = (desc) => {
  const t = (desc || "").trim().split(/\s+/)[0] || "";
  const c = t.replace(/[^A-Za-z0-9/-]/g, "");
  return c.length >= 3 ? c : null; // ignore junk leading tokens like "4
};

const { data: dists } = await supa.from("distributors").select("id, name, vendor_aliases");
function resolveDist(vendorExtracted) {
  const nv = norm(vendorExtracted);
  if (!nv) return null;
  let best = null, bestLen = -1;
  for (const d of dists || []) for (const a of d.vendor_aliases || []) {
    if (nv === a || nv.startsWith(a + " ")) { if (a.length > bestLen) { best = d; bestLen = a.length; } }
  }
  return best;
}

// idempotent reset of prior receipt-sourced rows
await supa.from("inv_vendor_prices").delete().eq("source", "receipt");
await supa.from("inv_vendor_skus").delete().eq("source", "receipt");

// seed sku map: (distId|sku) -> {id, item_id}
const { data: seedSkus } = await supa.from("inv_vendor_skus").select("id, distributor_id, vendor_sku, item_id");
const skuMap = new Map();
for (const s of seedSkus || []) skuMap.set(`${s.distributor_id}|${(s.vendor_sku || "").toLowerCase()}`, s);

const { data: exts } = await supa
  .from("receipt_extractions")
  .select("receipt_id, vendor_extracted, date_extracted, line_items")
  .not("line_items", "is", null);

// Pass 1 — collect candidate harvests (lines whose SKU isn't a known seed sku)
const cand = new Map(); // key (distId|sku|desc) -> row
const work = []; // {distId, sku, desc, qty, unit_cents, ext_cents, observed_on, receipt_id}
let lines = 0, matchedSeed = 0, noDist = 0;
for (const e of exts || []) {
  if (!Array.isArray(e.line_items)) continue;
  const dist = resolveDist(e.vendor_extracted);
  for (const li of e.line_items) {
    const desc = (li.description || "").trim();
    if (!desc) continue;
    lines++;
    if (!dist) { noDist++; }
    const distId = dist?.id || null;
    const sku = skuOf(desc);
    const known = distId && sku ? skuMap.get(`${distId}|${sku.toLowerCase()}`) : null;
    if (known) matchedSeed++;
    if (!known && distId) {
      const k = `${distId}|${(sku || "").toLowerCase()}|${desc}`;
      if (!cand.has(k)) cand.set(k, { distributor_id: distId, vendor_sku: sku, vendor_description: desc, source: "receipt", match_status: "candidate", times_seen: 0 });
      cand.get(k).times_seen++;
    }
    work.push({ distId, sku, desc, qty: Number(li.quantity) || null, unit_cents: cents(li.unit_price), ext_cents: cents(li.line_total), observed_on: e.date_extracted, receipt_id: e.receipt_id });
  }
}

// insert harvested candidates, get their ids back into the map
const candRows = [...cand.values()];
if (candRows.length) {
  const { data: ins, error } = await supa.from("inv_vendor_skus").insert(candRows).select("id, distributor_id, vendor_sku");
  if (error) { console.error("candidate insert failed:", error.message); process.exit(1); }
  for (const s of ins) skuMap.set(`${s.distributor_id}|${(s.vendor_sku || "").toLowerCase()}`, s);
}

// Pass 2 — price observations, linked to the resolved sku (+ its item, if known)
const priceRows = [];
for (const w of work) {
  const skuRow = w.distId && w.sku ? skuMap.get(`${w.distId}|${w.sku.toLowerCase()}`) : null;
  priceRows.push({
    item_id: skuRow?.item_id ?? null,
    distributor_id: w.distId,
    vendor_sku_id: skuRow?.id ?? null,
    qty: w.qty,
    uom: "EA",
    unit_price_cents: w.unit_cents,
    ext_price_cents: w.ext_cents,
    observed_on: w.observed_on,
    source: "receipt",
    receipt_id: w.receipt_id,
  });
}
for (let i = 0; i < priceRows.length; i += 400) {
  const { error } = await supa.from("inv_vendor_prices").insert(priceRows.slice(i, i + 400));
  if (error) { console.error("price insert failed:", error.message); process.exit(1); }
}

console.log(`lines: ${lines} | matched known SKU (seed): ${matchedSeed} | harvested candidates: ${candRows.length} | price obs: ${priceRows.length} | lines w/ no distributor: ${noDist}`);
