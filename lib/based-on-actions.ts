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
    // Voice notes come from the `recordings` table (the global Record button),
    // matched by customer- or job-targeted recordings. (Unifies the Record flow
    // with Based-on — Danny 2026-06-04; was pointed at the empty tech_voice_notes.)
    supa.from("recordings")
      .select("id, transcript, created_at, created_by, target_kind, target_ref, transcript_status")
      .or(jobIds.length
        ? `and(target_kind.eq.customer,target_ref.eq.${cid}),and(target_kind.eq.job,target_ref.in.(${jobIds.join(",")})),and(target_kind.eq.estimate,target_ref.eq.${cid})`
        : `and(target_kind.eq.customer,target_ref.eq.${cid})`)
      .not("transcript", "is", null)
      .order("created_at", { ascending: false }).limit(20),
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

  const voiceNotes: BasedOnVoiceNote[] = ((vnRes.data ?? []) as Array<{ id: string; transcript: string; created_at: string; created_by: string | null; transcript_status: string | null }>)
    .map((v) => ({ id: String(v.id), date: day(v.created_at), tech: v.created_by ?? "", snippet: (v.transcript_status === "needs_review" ? "⚠ unreliable — " : "") + snip(v.transcript) }));

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

/** Upload a photo for a "Based On…" draft → public job-photos bucket → returns a
 *  URL the generator can hand to Claude vision. (F — Danny 2026-06-04.) */
export async function uploadBasedOnPhoto(formData: FormData): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "no photo" };
  if (file.size > 15 * 1024 * 1024) return { ok: false, error: "photo too large (15MB max)" };
  const mime = file.type || "image/jpeg";
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("heic") ? "heic" : "jpg";
  const supa = db();
  const path = `based-on/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supa.storage.from("job-photos").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: mime, upsert: false });
  if (error) return { ok: false, error: `upload: ${error.message}` };
  const { data } = supa.storage.from("job-photos").getPublicUrl(path);
  return data?.publicUrl ? { ok: true, url: data.publicUrl } : { ok: false, error: "could not get public URL" };
}

// Upload-first variant (2026-06-08): the browser PUTs the photo straight to the
// job-photos bucket via a signed upload URL (no Vercel ~4.5MB body cap), then
// finalizeBasedOnPhoto returns the public URL the generator hands to Claude vision.
export type CreateBasedOnPhotoUploadResult = { ok: true; path: string; token: string } | { ok: false; error: string };

export async function createBasedOnPhotoUpload(input: { mime?: string }): Promise<CreateBasedOnPhotoUploadResult> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };
  const mime = input.mime || "image/jpeg";
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("heic") ? "heic" : "jpg";
  const supa = db();
  const path = `based-on/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { data: signed, error } = await supa.storage.from("job-photos").createSignedUploadUrl(path);
  if (error || !signed?.token) return { ok: false, error: `upload: ${error?.message ?? "no token"}` };
  return { ok: true, path: signed.path ?? path, token: signed.token };
}

export async function finalizeBasedOnPhoto(input: { path: string }): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };
  const path = String(input.path ?? "").trim();
  if (!path) return { ok: false, error: "missing path" };
  const { data } = db().storage.from("job-photos").getPublicUrl(path);
  return data?.publicUrl ? { ok: true, url: data.publicUrl } : { ok: false, error: "could not get public URL" };
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
  uploadedImageUrls?: string[];
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
    const { data } = await supa.from("recordings").select("transcript, created_at, created_by").in("id", sel.voiceNoteIds);
    const rows = (data ?? []) as Array<{ transcript: string; created_at: string; created_by: string | null }>;
    if (rows.length) {
      parts.push(`### Voice notes (transcripts)\n${rows.map((v) => `- (${day(v.created_at)}, ${v.created_by ?? "tech"}) ${v.transcript}`).join("\n\n")}`);
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
  if (sel.uploadedImageUrls && sel.uploadedImageUrls.length) {
    const n = sel.uploadedImageUrls.filter(Boolean).length;
    imageUrls = [...imageUrls, ...sel.uploadedImageUrls.filter(Boolean)].slice(0, 8);
    if (n) usedLabels.push(`${n} uploaded photo${n === 1 ? "" : "s"}`);
  }

  // Hard cap so an oversized selection (long call transcripts run 20k+ chars)
  // can't blow the generator's context window with an opaque failure.
  const referenceText = parts.join("\n\n").slice(0, 80000);
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
  if (!r.ok) {
    if (r.status === 413 || /too long|context length|maximum.*tokens|prompt is too long/i.test(text)) {
      return { ok: false, error: "Selection too large for one estimate — pick fewer or shorter captures." };
    }
    return { ok: false, error: `generator failed (${r.status}): ${text.slice(0, 200)}` };
  }
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
