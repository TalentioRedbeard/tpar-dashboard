// Seed distributor_locations from the Tulsa-supplier-locations research workflow.
// Matches each researched supplier to a distributors row (creates one for
// Morrison/NWS/Heatwave so they show as cards), inserts each branch. Idempotent
// by source='research'. Reads .env.local; never prints secrets.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const supa = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const OUT = process.argv[2] || "C:/Users/ddunl/AppData/Local/Temp/claude/C--tpar-supabase/fb3b4d2c-e4c8-4ed8-90a7-b6c895b6ee48/tasks/w7v0ybfli.output";
const d = JSON.parse(readFileSync(OUT, "utf8"));
const results = (d.result && d.result.results) || d.results || [];

const { data: dists } = await supa.from("distributors").select("id, name, vendor_key");
const cleanName = (s) => s.replace(/\s*\(.*$/, "").trim(); // strip only a trailing parenthetical
const isCatchAll = (s) => /other notable|independent .*supply|supply houses|tulsa-metro/i.test(s || "");
function findDist(supplier) {
  const s = supplier.toLowerCase();
  for (const dd of dists) {
    const kw = (dd.name || "").toLowerCase().split(/[ /]/)[0];
    if (kw && kw.length >= 4 && s.includes(kw)) return dd;
  }
  return null;
}

await supa.from("distributor_locations").delete().eq("source", "research");

let total = 0;
for (const r of results) {
  if (!r || !Array.isArray(r.locations) || !r.locations.length) continue;
  if (isCatchAll(r.supplier)) { console.log(`(skipped catch-all: ${r.locations.length} mixed listings — curate manually)`); continue; }
  let dist = findDist(r.supplier);
  let distId = dist?.id || null;
  const name = dist?.name || cleanName(r.supplier);
  if (!dist) {
    const vendor_key = name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const { data: ins, error } = await supa.from("distributors")
      .insert({ name, vendor_key, category: "plumbing_supply", website: r.website || null, is_active: true, sort_order: 100 })
      .select("id").single();
    if (error) { console.error("create distributor failed:", name, error.message); continue; }
    distId = ins?.id || null;
    if (distId) dists.push({ id: distId, name, vendor_key });
  }
  const rows = r.locations.map((l, i) => ({
    distributor_id: distId, supplier_name: name, label: l.label || name,
    address: l.address || null, phone: l.phone || null, website: l.website || r.website || null,
    hours: l.hours || null, notes: l.notes || null, sort_order: i, source: "research", is_active: true,
  }));
  const { error } = await supa.from("distributor_locations").insert(rows);
  if (error) { console.error("insert failed:", name, error.message); continue; }
  total += rows.length;
  console.log(`${name}: ${rows.length} branches (${r.confidence})`);
}
console.log("total branches seeded:", total);
