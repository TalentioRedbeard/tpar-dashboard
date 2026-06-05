// Inventory Phase 2b — seed the catalog spine from Danny's real files.
//   inv_vendor_skus  <- Winnelson Lookup Table.csv  (confirmed SKU<->plain translations)
//   inv_items        <- Van Inventory Tulsa Winnelson Receipt Language.csv (parts + cost + UOM)
// Idempotent: deletes its own prior seed (by source) before inserting.
// Run from the dashboard dir: node scripts/seed-inv-phase2b.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// --- env (read .env.local; never printed) ---
const env = {};
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
} catch { /* fall through to process.env */ }
const SUPA_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error("missing SUPABASE_URL / SERVICE_ROLE_KEY"); process.exit(1); }
const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

function parseCSV(txt) {
  const rows = []; let f = "", row = [], q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else { if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); f = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; } else if (c !== "\r") f += c; }
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const BIZ = "C:/Users/ddunl/OneDrive/Documents/TPAR/Documents/1.0 TPAR Business Docs/AI Bot Technical Files/Receipt Translator";

async function chunkedInsert(table, rows, size = 400) {
  let n = 0;
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await supa.from(table).insert(rows.slice(i, i + size));
    if (error) { console.error(`insert ${table} failed:`, error.message); process.exit(1); }
    n += Math.min(size, rows.length - i);
  }
  return n;
}

// Winnelson distributor id
const { data: dist } = await supa.from("distributors").select("id").eq("vendor_key", "winnelson").single();
const winnelsonId = dist?.id;
if (!winnelsonId) { console.error("Winnelson distributor not found"); process.exit(1); }

// --- inv_vendor_skus from Winnelson Lookup (confirmed translations) ---
const lookup = parseCSV(readFileSync(BIZ + "/Winnelson Lookup Table.csv", "utf8"));
const seenSku = new Set();
const skuRows = [];
for (const r of lookup) {
  const desc = (r[0] || "").trim();
  if (!desc) continue;
  const plain = (r[1] || "").trim() || null;
  const sku = desc.split(/\s+/)[0] || null;
  const key = `${sku || ""}|${desc}`;
  if (seenSku.has(key)) continue;
  seenSku.add(key);
  skuRows.push({ distributor_id: winnelsonId, vendor_sku: sku, vendor_description: desc, plain_alias: plain, source: "winnelson_lookup", match_status: "confirmed", match_confidence: 1 });
}

// --- inv_items from Van Par list ---
const par = parseCSV(readFileSync(BIZ + "/Van Inventory Tulsa Winnelson Receipt Language.csv", "utf8"));
const seenItem = new Set();
const itemRows = [];
for (const r of par.slice(1)) {
  const desc = (r[2] || "").trim();
  if (!desc) continue;
  const uc = (r[3] || "").trim(); // e.g. "3.7800 EA"
  const m = uc.match(/([\d.]+)\s*([A-Za-z]+)?/);
  const price = m ? parseFloat(m[1]) : NaN;
  const uom = m && m[2] ? m[2].toUpperCase() : "EA";
  const nn = norm(desc);
  if (seenItem.has(nn)) continue;
  seenItem.add(nn);
  itemRows.push({
    canonical_name: desc,
    normalized_name: nn,
    default_uom: uom,
    default_cost_cents: Number.isFinite(price) ? Math.round(price * 100) : null,
    source: "van_par",
  });
}

// idempotent: clear prior seed of these sources
await supa.from("inv_vendor_skus").delete().eq("source", "winnelson_lookup");
await supa.from("inv_items").delete().eq("source", "van_par");

const nSku = await chunkedInsert("inv_vendor_skus", skuRows);
const nItem = await chunkedInsert("inv_items", itemRows);
console.log(`seeded inv_vendor_skus: ${nSku} (Winnelson lookup) | inv_items: ${nItem} (van par)`);
