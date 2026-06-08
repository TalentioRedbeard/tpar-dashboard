#!/usr/bin/env node
// twilio-status.mjs — pre-flight for the Monday field-tech kickoff. Reports:
//  (1) who the kickoff will text (field-tech-broadcast dry_run — NO sends), and
//  (2) the Twilio A2P 10DLC registration status (twilio-a2p-status), then judges
//      whether outbound texts from our number will actually deliver to US mobiles.
// Read-only / no sends. Run from C:\tpar-dashboard:  node scripts\twilio-status.mjs

import { readFileSync } from "node:fs";
function loadEnvLocal(p) { const o = {}; try { for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, "").trim(); } } catch {} return o; }
const env = loadEnvLocal("./.env.local");
const URL = process.env.SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Missing SUPABASE_URL / SERVICE key in ./.env.local"); process.exit(1); }
const hdr = { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` };
const last10 = (s) => String(s ?? "").replace(/\D/g, "").slice(-10);
const call = (fn, body) => fetch(`${URL}/functions/v1/${fn}`, { method: "POST", headers: hdr, body: JSON.stringify(body) }).then((r) => r.json());

(async () => {
  console.log("=== Monday field-tech kickoff — pre-flight ===\n");

  // (1) Who gets texted (dry run — no sends)
  const dr = await call("field-tech-broadcast", { dry_run: true });
  console.log("1) KICKOFF RECIPIENTS (dry run, no sends):");
  if (!dr?.ok) console.log("   ✗ dry run failed:", JSON.stringify(dr));
  else {
    console.log(`   attempted=${dr.attempted} bad_phone=${JSON.stringify(dr.bad_phone ?? [])}`);
    for (const r of dr.recipients ?? []) console.log(`   · ${r.name}: ${r.status}`);
  }

  // (2) A2P registration status
  const a = await call("twilio-a2p-status", {});
  console.log("\n2) TWILIO A2P 10DLC STATUS:");
  if (!a?.ok) { console.log("   ✗ a2p-status failed:", JSON.stringify(a)); process.exit(1); }

  const from = a.from;
  console.log(`   send-sms sends FROM: ${from}  (raw From — NOT a Messaging Service)`);
  console.log(`   account numbers: ${JSON.stringify(a.account_numbers)}`);
  console.log(`   brands: ${JSON.stringify((a.brands ?? []).map((b) => ({ status: b.status, type: b.brand_type ?? b.entity_type })))}`);
  console.log("   messaging services:");
  const svcOf = (num) => (a.services ?? []).find((s) => (s.senders ?? []).some((n) => last10(n) === last10(num)));
  for (const s of a.services ?? []) {
    const camps = Array.isArray(s.usa2p) ? s.usa2p : (s.usa2p?.compliance ?? []);
    const cstat = (camps ?? []).map((c) => c.campaign_status ?? c.status).join(",") || "(no campaign)";
    console.log(`   · ${s.name} [${s.sid}] senders=${JSON.stringify(s.senders)} campaign=${cstat}`);
  }

  // (3) Verdict
  const fromSvc = svcOf(from);
  const svc7180 = svcOf("9182287180");
  const campApproved = (s) => {
    const camps = Array.isArray(s?.usa2p) ? s.usa2p : (s?.usa2p?.compliance ?? []);
    return (camps ?? []).some((c) => ["VERIFIED", "APPROVED"].includes(String(c.campaign_status ?? c.status ?? "").toUpperCase()));
  };
  const brandOk = (a.brands ?? []).some((b) => ["APPROVED", "VERIFIED"].includes(String(b.status ?? "").toUpperCase()));
  console.log("\n3) VERDICT:");
  console.log(`   FROM (${from}) is 918-228-7180? ${last10(from) === "9182287180" ? "YES" : "NO"}`);
  console.log(`   FROM is in a Messaging Service? ${fromSvc ? `${fromSvc.name}` : "NO"}`);
  console.log(`   that service has an approved A2P campaign? ${fromSvc ? campApproved(fromSvc) : "n/a"}`);
  console.log(`   any A2P brand approved? ${brandOk}`);
  // failure detail for any non-approved campaign (what to fix in Twilio)
  for (const s of a.services ?? []) {
    const camps = Array.isArray(s.usa2p) ? s.usa2p : (s.usa2p?.compliance ?? []);
    for (const c of camps ?? []) {
      const st = String(c.campaign_status ?? c.status ?? "").toUpperCase();
      if (st && !["VERIFIED", "APPROVED"].includes(st)) {
        console.log(`\n   CAMPAIGN DETAIL [${s.name}] status=${st} usecase=${c.us_app_to_person_usecase ?? c.usecase ?? "?"}`);
        console.log("   errors/rejection: " + JSON.stringify(c.errors ?? c.rejection_reason ?? c.failure_reason ?? c, null, 0).slice(0, 800));
      }
    }
  }
  if (fromSvc && campApproved(fromSvc)) {
    console.log("   ⚠ FROM is covered by an approved campaign — BUT send-sms sends via raw From, so texts won't ride the campaign until send-sms is rewired to MessagingServiceSid. Deliverability uncertain.");
  } else {
    console.log("   ✗ FROM is NOT covered by an approved A2P campaign → outbound texts to US mobiles risk carrier filtering (30034). The Monday kickoff may not deliver. Fix A2P (campaign + put the number in the service) before relying on the text.");
  }
})();
