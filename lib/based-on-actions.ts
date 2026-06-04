"use server";

// "Based On…" — context-assembler for the multi-option estimate builder.
// Lets the operator seed an estimate draft from a mix of existing context:
// internal notes, voice-note transcripts, selected comms, the customer 360,
// and (when a job is in play) the job 360. Selected sources are assembled into
// one reference blob and handed to generate-estimate-from-reference, whose
// structured option output is mapped back into the builder's editable shape
// (custom line items + hours/crew/materials) so the operator reviews + adjusts
// before pushing. Nothing auto-sends. Photos/vision land in a fast-follow.

import { requireWriter } from "./current-tech";
import { db } from "./supabase";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// ── Picker payloads ─────────────────────────────────────────────────────────
export type BasedOnNote = { id: string; kind: "customer" | "job"; date: string; snippet: string };
export type BasedOnVoiceNote = { id: string; date: string; tech: string; snippet: string };
export type BasedOnComm = { id: number; date: string; channel: string; direction: string; snippet: string };
export type BasedOnJob = { hcp_job_id: string; label: string };
export type BasedOnPhoto = { id: number; url: string; label: string };

export type BasedOnSources = {
  notes: BasedOnNote[];
  voiceNotes: BasedOnVoiceNote[];
  comms: BasedOnComm[];
  jobs: BasedOnJob[];
  photos: BasedOnPhoto[];
  hasCustomer360: boolean;
};

const snip = (s: string | null | undefined, n = 100) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const day = (s: unknown) => (s ? String(s).slice(0, 10) : "");

/** List the context available to seed a "Based On…" draft for this customer. */
export async function fetchBasedOnSources(hcpCustomerId: string, _hcpJobId?: string): Promise<BasedOnSources> {
  const empty: BasedOnSources = { notes: [], voiceNotes: [], comms: [], jobs: [], photos: [], hasCustomer360: false };
  const writer = await requireWriter();
  if (!writer.ok) return empty;
  const cid = String(hcpCustomerId ?? "").trim();
  if (!cid.startsWith("cus_")) return empty;
  const supa = db();

  const { data: jobsRaw } = await supa
    .from("hcp_jobs_raw")
    .select("hcp_job_id, raw, scheduled_start")
    .eq("hcp_customer_id", cid)
    .order("scheduled_start", { ascending: false, nullsFirst: false })
    .limit(25);
  const jobIds = (jobsRaw ?? []).map((j) => j.hcp_job_id as string).filter(Boolean);

  const [cNotesRes, jNotesRes, vnRes, commsRes, c360Res, photosRes] = await Promise.all([
    supa.from("customer_notes").select("id, body, created_at").eq("hcp_customer_id", cid).order("created_at", { ascending: false }).limit(15),
    jobIds.length
      ? supa.from("job_notes").select("id, body, created_at").in("hcp_job_id", jobIds).order("created_at", { ascending: false }).limit(15)
      : Promise.resolve({ data: [] as Array<{ id: string; body: string; created_at: string }> }),
    supa.from("tech_voice_notes")
      .select("id, transcript, ts, tech_short_name, hcp_customer_id, hcp_job_id")
      .or(jobIds.length ? `hcp_customer_id.eq.${cid},hcp_job_id.in.(${jobIds.join(",")})` : `hcp_customer_id.eq.${cid}`)
      .not("transcript", "is", null)
      .order("ts", { ascending: false }).limit(20),
    supa.from("communication_events")
      .select("id, content_text, summary, occurred_at, channel, direction")
      .eq("hcp_customer_id", cid).order("occurred_at", { ascending: false }).limit(30),
    supa.from("customer_360").select("hcp_customer_id").eq("hcp_customer_id", cid).maybeSingle(),
    jobIds.length
      ? supa.from("job_photos").select("id, public_url, photo_type, uploaded_at").in("hcp_job_id", jobIds).not("public_url", "is", null).order("uploaded_at", { ascending: false }).limit(24)
      : Promise.resolve({ data: [] as Array<{ id: number; public_url: string | null; photo_type: string | null; uploaded_at: string }> }),
  ]);

  const notes: BasedOnNote[] = [
    ...((cNotesRes.data ?? []) as Array<{ id: string; body: string; created_at: string }>).map((n) => ({ id: String(n.id), kind: "customer" as const, date: day(n.created_at), snippet: snip(n.body) })),
    ...((jNotesRes.data ?? []) as Array<{ id: string; body: string; created_at: string }>).map((n) => ({ id: String(n.id), kind: "job" as const, date: day(n.created_at), snippet: snip(n.body) })),
  ];

  const voiceNotes: BasedOnVoiceNote[] = ((vnRes.data ?? []) as Array<{ id: string; transcript: string; ts: string; tech_short_name: string | null }>)
    .map((v) => ({ id: String(v.id), date: day(v.ts), tech: v.tech_short_name ?? "", snippet: snip(v.transcript) }));

  const comms: BasedOnComm[] = ((commsRes.data ?? []) as Array<{ id: number; content_text: string | null; summary: string | null; occurred_at: string; channel: string | null; direction: string | null }>)
    .map((c) => ({ id: Number(c.id), date: day(c.occurred_at), channel: c.channel ?? "", direction: c.direction ?? "", snippet: snip(c.content_text || c.summary) }))
    .filter((c) => c.snippet.length > 0);

  const jobs: BasedOnJob[] = ((jobsRaw ?? []) as Array<{ hcp_job_id: string; raw: Record<string, unknown>; scheduled_start: string | null }>)
    .map((j) => {
      const raw = (j.raw ?? {}) as Record<string, unknown>;
      const addr = (raw["address"] ?? {}) as Record<string, unknown>;
      const bits = [day(j.scheduled_start), typeof raw["work_status"] === "string" ? raw["work_status"] as string : "", typeof addr["street"] === "string" ? addr["street"] as string : ""].filter(Boolean);
      return { hcp_job_id: j.hcp_job_id, label: bits.join(" · ") || j.hcp_job_id };
    });

  const photos: BasedOnPhoto[] = ((photosRes.data ?? []) as Array<{ id: number; public_url: string | null; photo_type: string | null; uploaded_at: string }>)
    .filter((p) => p.public_url)
    .map((p) => ({ id: Number(p.id), url: p.public_url as string, label: `${day(p.uploaded_at)} · ${p.photo_type ?? "photo"}` }));

  return { notes, voiceNotes, comms, jobs, photos, hasCustomer360: !!c360Res.data };
}

// ── Generate ────────────────────────────────────────────────────────────────
export type BasedOnSelection = {
  freeform?: string;
  noteIds?: string[];
  voiceNoteIds?: string[];
  commIds?: number[];
  includeCustomer360?: boolean;
  jobId?: string;
  includeJob360?: boolean;
  photoIds?: number[];
};

// Builder-shaped draft (maps onto MultiOptionEstimateBuilder's Opt/Line state).
export type BasedOnDraftLine = { name: string; description: string; hours: string; crew: string; materials: string };
export type BasedOnDraftOption = { name: string; lines: BasedOnDraftLine[] };
export type BasedOnResult =
  | { ok: true; options: BasedOnDraftOption[]; note: string; sourceSummary: string }
  | { ok: false; error: string };

function compact360(row: Record<string, unknown>): string {
  // Flatten a 360 view row to "key: value" lines, skipping nulls/empties and
  // huge/array/object fields the model doesn't need.
  return Object.entries(row)
    .filter(([k, v]) => v != null && v !== "" && !Array.isArray(v) && typeof v !== "object" && !k.endsWith("_id"))
    .slice(0, 40)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join("\n");
}

export async function generateBasedOnEstimate(hcpCustomerId: string, sel: BasedOnSelection): Promise<BasedOnResult> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, error: "server config missing" };
  const cid = String(hcpCustomerId ?? "").trim();
  if (!cid.startsWith("cus_")) return { ok: false, error: "A valid customer is required." };
  const supa = db();

  const parts: string[] = [];
  const usedLabels: string[] = [];

  if (sel.freeform && sel.freeform.trim()) {
    parts.push(`### Freeform context\n${sel.freeform.trim()}`);
    usedLabels.push("freeform notes");
  }

  if (sel.noteIds && sel.noteIds.length) {
    const [cn, jn] = await Promise.all([
      supa.from("customer_notes").select("body, created_at").in("id", sel.noteIds),
      supa.from("job_notes").select("body, created_at").in("id", sel.noteIds),
    ]);
    const all = [...((cn.data ?? []) as Array<{ body: string; created_at: string }>), ...((jn.data ?? []) as Array<{ body: string; created_at: string }>)];
    if (all.length) {
      parts.push(`### Internal notes\n${all.map((n) => `- (${day(n.created_at)}) ${n.body}`).join("\n")}`);
      usedLabels.push(`${all.length} note${all.length === 1 ? "" : "s"}`);
    }
  }

  if (sel.voiceNoteIds && sel.voiceNoteIds.length) {
    const { data } = await supa.from("tech_voice_notes").select("transcript, ts, tech_short_name").in("id", sel.voiceNoteIds);
    const rows = (data ?? []) as Array<{ transcript: string; ts: string; tech_short_name: string | null }>;
    if (rows.length) {
      parts.push(`### Voice notes (transcripts)\n${rows.map((v) => `- (${day(v.ts)}, ${v.tech_short_name ?? "tech"}) ${v.transcript}`).join("\n\n")}`);
      usedLabels.push(`${rows.length} voice note${rows.length === 1 ? "" : "s"}`);
    }
  }

  if (sel.commIds && sel.commIds.length) {
    const { data } = await supa.from("communication_events").select("content_text, summary, occurred_at, channel, direction").in("id", sel.commIds).order("occurred_at", { ascending: true });
    const rows = (data ?? []) as Array<{ content_text: string | null; summary: string | null; occurred_at: string; channel: string | null; direction: string | null }>;
    if (rows.length) {
      parts.push(`### Communications\n${rows.map((c) => `- (${day(c.occurred_at)}, ${c.channel ?? ""}/${c.direction ?? ""}) ${c.content_text || c.summary || ""}`).join("\n")}`);
      usedLabels.push(`${rows.length} comm${rows.length === 1 ? "" : "s"}`);
    }
  }

  if (sel.includeCustomer360) {
    const { data } = await supa.from("customer_360").select("*").eq("hcp_customer_id", cid).maybeSingle();
    if (data) { parts.push(`### Customer 360\n${compact360(data as Record<string, unknown>)}`); usedLabels.push("customer 360"); }
  }

  if (sel.includeJob360 && sel.jobId) {
    const { data } = await supa.from("job_360").select("*").eq("hcp_job_id", sel.jobId).maybeSingle();
    if (data) { parts.push(`### Job 360\n${compact360(data as Record<string, unknown>)}`); usedLabels.push("job 360"); }
  }

  // Photos → vision. Resolve selected photo ids to their public bucket URLs
  // (which Anthropic can fetch); capped to 8 in the edge fn.
  let imageUrls: string[] = [];
  if (sel.photoIds && sel.photoIds.length) {
    const { data } = await supa.from("job_photos").select("public_url").in("id", sel.photoIds);
    imageUrls = ((data ?? []) as Array<{ public_url: string | null }>).map((p) => p.public_url ?? "").filter(Boolean).slice(0, 8);
    if (imageUrls.length) usedLabels.push(`${imageUrls.length} photo${imageUrls.length === 1 ? "" : "s"}`);
  }

  const referenceText = parts.join("\n\n");
  if (!referenceText.trim() && imageUrls.length === 0) return { ok: false, error: "Pick at least one source (notes, voice, comms, 360, or photos) — or type freeform context." };

  let r: Response;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/generate-estimate-from-reference`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        reference_type: "freeform_text",
        reference_text: referenceText,
        hcp_customer_id: cid,
        ...(sel.jobId ? { hcp_job_id: sel.jobId } : {}),
        ...(imageUrls.length ? { image_urls: imageUrls } : {}),
        target_scope: "full_option_set",
      }),
    });
  } catch (e) {
    return { ok: false, error: `generator unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
  const text = await r.text();
  if (!r.ok) return { ok: false, error: `generator failed (${r.status}): ${text.slice(0, 200)}` };
  let parsed: { ok?: boolean; error?: string; output?: { options?: unknown[] } };
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "generator returned non-JSON" }; }
  if (!parsed.ok) return { ok: false, error: parsed.error ?? "generator returned ok=false" };

  const rawOptions = Array.isArray(parsed.output?.options) ? parsed.output!.options! : [];
  if (rawOptions.length === 0) return { ok: false, error: "Generator produced no options — try adding more context." };

  const num = (v: unknown, d = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const options: BasedOnDraftOption[] = rawOptions.map((oRaw) => {
    const o = (oRaw ?? {}) as Record<string, unknown>;
    const rank = typeof o["rank"] === "string" ? (o["rank"] as string) : "";
    const baseName = (typeof o["name"] === "string" && o["name"].trim()) ? (o["name"] as string).trim() : "Option";
    const lis = Array.isArray(o["line_items"]) ? (o["line_items"] as unknown[]) : [];
    const lines: BasedOnDraftLine[] = lis.map((liRaw) => {
      const li = (liRaw ?? {}) as Record<string, unknown>;
      const hoursObj = (li["hours"] ?? {}) as Record<string, unknown>;
      const hoursTotal = num(hoursObj["total"], num(li["total_hours"], 0));
      return {
        name: (typeof li["name"] === "string" ? li["name"] as string : "Line item").slice(0, 200),
        description: typeof li["description"] === "string" ? li["description"] as string : "",
        hours: String(hoursTotal || 0),
        crew: String(num(li["crew_size"], 2) || 2),
        materials: String(Math.round(num(li["materials_cost"], 0))),
      };
    }).filter((l) => l.name);
    return { name: rank ? `${baseName} (${rank})` : baseName, lines };
  }).filter((o) => o.lines.length > 0);

  if (options.length === 0) return { ok: false, error: "Generator output had no usable line items — try different/more context." };

  return {
    ok: true,
    options,
    note: `Drafted by "Based On…" from: ${usedLabels.join(", ")}. Review hours/crew/materials + descriptions before pushing.`,
    sourceSummary: usedLabels.join(", "),
  };
}
