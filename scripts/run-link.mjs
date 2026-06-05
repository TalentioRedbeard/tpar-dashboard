// One-time backfill: loop-invoke inv-link-candidates until every harvested
// candidate is adjudicated (auto-linked or queued for review). Reads .env.local.
import { readFileSync } from "node:fs";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const U = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const K = env.SUPABASE_SERVICE_ROLE_KEY;
const fn = `${U}/functions/v1/inv-link-candidates`;
let auto = 0, q = 0;
for (let i = 0; i < 15; i++) {
  const r = await fetch(fn, { method: "POST", headers: { Authorization: `Bearer ${K}`, "Content-Type": "application/json" }, body: "{}" });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) { console.error("error:", j); break; }
  auto += j.autolinked; q += j.queued;
  console.log(`processed ${j.processed} | auto +${j.autolinked} | queued +${j.queued} | remaining ${j.remaining}`);
  if (j.remaining === 0) break;
}
console.log(`done. auto-linked ${auto}, queued for review ${q}`);
