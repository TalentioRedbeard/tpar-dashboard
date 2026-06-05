// One-time backfill: loop-invoke inv-categorize-items until every inv_item has a
// category. Reads .env.local (never prints secrets). Run from the dashboard dir.
import { readFileSync } from "node:fs";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const URL_ = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const fn = `${URL_}/functions/v1/inv-categorize-items`;
let total = 0;
for (let i = 0; i < 12; i++) {
  const r = await fetch(fn, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: "{}" });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) { console.error("error:", j); break; }
  total += j.categorized;
  console.log(`batch +${j.categorized} | remaining ${j.remaining}`);
  if (j.remaining === 0) break;
}
console.log("total categorized:", total);
