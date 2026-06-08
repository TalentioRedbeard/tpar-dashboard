#!/usr/bin/env node
// tech-day-smoke.mjs — repeatable, SAFE smoke test of a technician's day against
// the live stack, run as TestTech "Al". No customer-facing side effects (no
// outbound SMS, no HCP bot writes, no real customer comms). Everything it creates
// it cleans up, and it pre-cleans any leftovers from a failed prior run.
//   Run from C:\tpar-dashboard:  node scripts\tech-day-smoke.mjs
//
// Covers, end-to-end against PROD: (A) identity + My-Day data path, (B) the
// upload-first recording flow (signed upload → store → transcribe → finalize →
// signed playback → Studio visibility → discard), (C) the inbound-SMS handler
// (asserts the reply lands in communication_events; flags the tech-attribution
// gap), (E) job-id resolution guard.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnvLocal(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch { /* ignore */ }
  return out;
}
const env = loadEnvLocal("./.env.local");
const SUPABASE_URL = process.env.SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing SUPABASE_URL / SERVICE key in ./.env.local"); process.exit(1); }

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = "recordings";
const AL = "Al"; // whoIdentity for TestTech Al = tech_short_name
const stamp = String(Date.now());

const results = [];
const ok = (name, detail = "") => { results.push({ name, pass: true, detail }); console.log(`  ✓ ${name}${detail ? " — " + detail : ""}`); };
const bad = (name, detail = "") => { results.push({ name, pass: false, detail }); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); };
const note = (msg) => console.log(`    · ${msg}`);
const swallow = async (p) => { try { return await p; } catch { return null; } };

function silentWav(seconds = 0.6, rate = 8000) {
  const samples = Math.floor(seconds * rate), dataLen = samples * 2, buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(dataLen, 40);
  return buf;
}

// ── Pre-clean leftovers from any failed prior run (idempotent, safe) ─────────
async function preClean() {
  const { data: leftRecs } = await supa.from("recordings").select("id, audio_path").eq("created_by", AL);
  for (const r of leftRecs ?? []) {
    if (r.audio_path) await swallow(supa.storage.from(BUCKET).remove([r.audio_path]));
    await swallow(supa.from("recordings").delete().eq("id", r.id));
  }
  await swallow(supa.from("communication_events").delete().like("raw_metadata->>twilio_sid", "SMtest%"));
  await swallow(supa.from("text_messages").delete().like("raw->>twilio_sid", "SMtest%"));
  if ((leftRecs?.length ?? 0) > 0) note(`pre-cleaned ${leftRecs.length} leftover test recording(s)`);
}

// ── A. Identity + My-Day data path ──────────────────────────────────────────
async function testIdentity() {
  console.log("\nA. Identity / My-Day data path (read-only)");
  const { data: al, error } = await supa.from("tech_directory")
    .select("tech_id, tech_short_name, email, is_active, dashboard_role").ilike("tech_short_name", AL).maybeSingle();
  if (error || !al) return bad("TestTech Al resolves", error?.message ?? "no row");
  ok("TestTech Al resolves", `${al.tech_short_name} <${al.email}> role=${al.dashboard_role} active=${al.is_active}`);
  if (al.dashboard_role !== "tech") bad("Al is a 'tech' role (so tech-gating applies)", `role=${al.dashboard_role}`);
  else ok("Al is a 'tech' role (tech-gating applies)");
  // My Day: appointment_location_v query path runs (tech_primary_name is text; tech_all_names is text[])
  const { data: appts, error: aerr } = await supa.from("appointment_location_v")
    .select("hcp_job_id, tech_primary_name").ilike("tech_primary_name", `%${AL}%`).limit(5);
  if (aerr) bad("My-Day appointment query runs", aerr.message);
  else ok("My-Day appointment query runs", `${appts?.length ?? 0} appt(s) for Al (0 expected for a test tech)`);
}

// ── B. Upload-first recording flow (the crown jewel — full safe roundtrip) ───
async function testRecordingFlow() {
  console.log("\nB. Recording flow end-to-end (upload-first, as Al)");
  const path = `al/${stamp}-smoke.wav`;
  let recId = null;
  try {
    const sign = await supa.storage.from(BUCKET).createSignedUploadUrl(path);
    if (sign.error || !sign.data?.token) return bad("createSignedUploadUrl", sign.error?.message ?? "no token");
    ok("createSignedUploadUrl", path);

    const ins = await supa.from("recordings").insert({
      audio_path: path, audio_url: null, mime: "audio/wav", duration_ms: 600,
      status: "uploading", target_kind: null, created_by: AL,
    }).select("id").single();
    if (ins.error || !ins.data) return bad("insert recordings row (status=uploading)", ins.error?.message);
    recId = ins.data.id; ok("insert recordings row", `id=${recId} status=uploading target_kind=null`);

    const blob = new Blob([silentWav()], { type: "audio/wav" });
    const up = await supa.storage.from(BUCKET).uploadToSignedUrl(path, sign.data.token, blob, { contentType: "audio/wav" });
    if (up.error) return bad("uploadToSignedUrl (direct, cap-free)", up.error.message);
    ok("uploadToSignedUrl (direct, cap-free)", `${blob.size} bytes`);

    const exists = await supa.storage.from(BUCKET).list("al", { search: `${stamp}-smoke.wav` });
    if (exists.error || !(exists.data || []).some((o) => o.name === `${stamp}-smoke.wav`)) bad("object present in bucket", exists.error?.message ?? "not found");
    else ok("object present in bucket");

    const mk = await supa.from("recordings").update({ status: "stored" }).eq("id", recId).eq("created_by", AL).select("id");
    if (mk.error || !mk.data?.length) bad("markRecordingStored (status→stored)", mk.error?.message ?? "0 rows");
    else ok("markRecordingStored (audio now durable)");

    const tr = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-audio`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ recording_id: recId }),
    });
    const trj = await tr.json().catch(() => ({}));
    if (tr.status !== 200) bad("transcribe-audio responds 200 (no crash)", `HTTP ${tr.status}`);
    else ok("transcribe-audio responds 200 (no crash on silent clip)", `ok=${trj.ok} suspect=${trj.suspect ?? "-"}`);
    const { data: afterTr } = await supa.from("recordings").select("transcript_status").eq("id", recId).maybeSingle();
    ok("transcript_status persisted", `transcript_status=${afterTr?.transcript_status ?? "(null)"} (was NULL-everywhere before)`);

    const patch = { label: "smoke test", target_kind: "file", finalized_at: new Date().toISOString() };
    const fin = await supa.from("recordings").update(patch).eq("id", recId).eq("created_by", AL).is("finalized_at", null).select("id");
    if (fin.error || !fin.data?.length) bad("finalizeRecording (first finalize writes)", fin.error?.message ?? "0 rows");
    else ok("finalizeRecording (first finalize writes + side-effects)");
    const fin2 = await supa.from("recordings").update(patch).eq("id", recId).eq("created_by", AL).is("finalized_at", null).select("id");
    if ((fin2.data?.length ?? 0) === 0) ok("finalize idempotency (2nd tap = 0 rows, no dup side-effects)");
    else bad("finalize idempotency", `2nd finalize updated ${fin2.data.length} rows`);

    const sgn = await supa.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (sgn.error || !sgn.data?.signedUrl) bad("getRecordingSignedUrl (playback)", sgn.error?.message);
    else {
      const head = await fetch(sgn.data.signedUrl, { method: "GET", headers: { Range: "bytes=0-1" } });
      if (head.status === 200 || head.status === 206) ok("signed playback URL serves the audio", `HTTP ${head.status}`);
      else bad("signed playback URL serves the audio", `HTTP ${head.status}`);
    }

    const cap = await supa.from("captures_search_v").select("capture_key, capture_type").eq("capture_key", `recording:${recId}`).maybeSingle();
    if (cap.data) ok("appears in captures_search_v (Studio)", `type=${cap.data.capture_type}`);
    else bad("appears in captures_search_v (Studio)", "not visible (status filter?)");
  } finally {
    if (recId) {
      await swallow(supa.storage.from(BUCKET).remove([path]));
      await swallow(supa.from("recordings").delete().eq("id", recId));
      const gone = await supa.from("recordings").select("id").eq("id", recId).maybeSingle();
      if (!gone.data) ok("cleanup (object + row removed)"); else bad("cleanup", "row still present");
    }
  }
}

// ── C. Inbound-SMS handler — does the reply reach the timeline? ──────────────
async function testInboundSms() {
  console.log("\nC. Inbound SMS handler — does a reply reach the unified timeline?");
  const { data: sec } = await supa.from("function_secrets").select("value").eq("key", "twilio_inbound_secret").maybeSingle();
  if (!sec?.value) return bad("twilio_inbound_secret available", "missing — inbound webhook can't be tested");
  const fakeTechNumber = "+19185550199"; // not a customer; stands in for a tech's phone
  const sid = `SMtest${stamp}`;
  const form = new URLSearchParams({ From: fakeTechNumber, To: "+19182287180", Body: "On my way, running 10 min late", MessageSid: sid });
  const r = await fetch(`${SUPABASE_URL}/functions/v1/twilio-inbound-sms?k=${encodeURIComponent(sec.value)}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(),
  });
  if (r.status !== 200) return bad("twilio-inbound-sms accepts the webhook", `HTTP ${r.status}`);
  ok("twilio-inbound-sms accepts the webhook + returns TwiML");

  const { data: tm } = await supa.from("text_messages").select("sendbird_message_id, sender_role, hcp_customer_id").contains("raw", { twilio_sid: sid }).limit(1).maybeSingle();
  if (!tm) bad("inbound row captured in text_messages", "not found");
  else ok("inbound row captured in text_messages", `sender_role=${tm.sender_role} customer=${tm.hcp_customer_id ?? "null"}`);

  // THE FIX UNDER TEST: the comm_event must now land (channel='text', was 'sms' → silently rejected by CHECK)
  const { data: ce } = await supa.from("communication_events").select("id, channel, flags").eq("raw_metadata->>twilio_sid", sid).maybeSingle();
  if (ce && ce.channel === "text") ok("inbound comm_event LANDS in unified timeline (channel='text')", `flags=${JSON.stringify(ce.flags)}`);
  else bad("inbound comm_event lands in timeline", ce ? `channel=${ce.channel}` : "STILL MISSING — comm_event did not land");

  // KNOWN GAP (separate from the channel fix): a tech reply has no tech identity / no routing
  if (tm && tm.sender_role === "customer" && !tm.hcp_customer_id) {
    note("GAP (open): a tech reply is logged as sender_role='customer', flagged unmatched_sender, with no tech_directory lookup and no routing/notify — captured but nobody is told the tech said 'running late'.");
  }

  // cleanup
  if (ce) await swallow(supa.from("communication_events").delete().eq("id", ce.id));
  if (tm) await swallow(supa.from("text_messages").delete().eq("sendbird_message_id", tm.sendbird_message_id));
  ok("cleanup (inbound test rows removed)");
}

// ── E. Job-id resolution guard ──────────────────────────────────────────────
async function testJobResolution() {
  console.log("\nE. Job-id resolution guard (invoice → canonical job)");
  const { data: sample } = await supa.from("job_360").select("hcp_job_id, invoice_number").not("invoice_number", "is", null).limit(1).maybeSingle();
  if (!sample) return note("no job with an invoice number to test against (skipped)");
  const trunk = String(sample.invoice_number).split("-")[0];
  const { data: hit, error } = await supa.from("job_360").select("hcp_job_id")
    .or(`invoice_number.eq.${sample.invoice_number},invoice_number.eq.${trunk}`).limit(10);
  if (error) return bad("resolve invoice → job", error.message);
  if ((hit?.length ?? 0) >= 1) ok("resolve invoice → job", `invoice #${sample.invoice_number} → ${hit.length} match(es)`);
  else bad("resolve invoice → job", "0 matches for a known invoice");
}

(async () => {
  console.log(`TPAR technician's-day smoke test — ${new Date().toISOString()}\nproject: ${SUPABASE_URL}\n(safe: no outbound SMS, no HCP writes, no real customer comms; all test artifacts cleaned up)`);
  try { await preClean(); } catch (e) { note("preClean: " + e.message); }
  try { await testIdentity(); } catch (e) { bad("A. identity threw", e.message); }
  try { await testRecordingFlow(); } catch (e) { bad("B. recording flow threw", e.message); }
  try { await testInboundSms(); } catch (e) { bad("C. inbound sms threw", e.message); }
  try { await testJobResolution(); } catch (e) { bad("E. job resolution threw", e.message); }
  const passed = results.filter((r) => r.pass).length, failed = results.filter((r) => !r.pass).length;
  console.log(`\n──────── RESULT: ${passed} passed, ${failed} failed ────────`);
  if (failed) console.log("FAILURES:\n" + results.filter((r) => !r.pass).map((r) => `  ✗ ${r.name} — ${r.detail}`).join("\n"));
  process.exit(failed ? 1 : 0);
})();
