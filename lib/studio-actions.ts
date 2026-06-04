"use server";

// Studio ("Based on…" station) — search every capture in the system
// (recordings, notes, comms, photos) and build an estimate draft from any
// selection. Spine = captures_search_v. (G — Danny 2026-06-04.)

import { db } from "./supabase";
import { getCurrentTech, requireWriter } from "./current-tech";
import { getRecordingSignedUrl } from "./recordings";
import { generateBasedOnEstimate, type BasedOnResult } from "./based-on-actions";

export type Capture = {
  capture_type: string;        // recording | note | comm | photo
  capture_id: string;
  subtype: string | null;
  title: string;
  snippet: string;
  body_len: number;
  hcp_customer_id: string | null;
  hcp_job_id: string | null;
  customer_name: string | null;
  tech: string | null;
  occurred_at: string;
  media_kind: string | null;   // audio | image | null
  media_url: string | null;    // audio_path (recordings) | public_url (photos)
  status: string | null;
};

// Leadership-only: the station searches ALL company comms + every customer,
// the same data the field-app gate keeps techs out of (/comms, /customers).
async function gate() {
  const me = await getCurrentTech();
  if (!me) return null;
  if (!me.isAdmin && !me.isManager) return null;
  return me;
}

export async function searchCaptures(query: string, type?: string): Promise<Capture[]> {
  if (!(await gate())) return [];
  const supa = db();
  let q = supa.from("captures_search_v").select("*").order("occurred_at", { ascending: false }).limit(60);
  if (type && type !== "all") q = q.eq("capture_type", type);
  const term = query.trim().replace(/[,()%*\\]/g, " ").trim();
  if (term.length >= 2) q = q.or(`body_text.ilike.%${term}%,title.ilike.%${term}%,customer_name.ilike.%${term}%`);
  const { data } = await q;
  const rows = (data ?? []) as Array<Record<string, any>>;

  // Enrich customer names for customer-/job-targeted captures.
  const custIds = [...new Set(rows.map((r) => r.hcp_customer_id).filter(Boolean))] as string[];
  const jobIds = [...new Set(rows.map((r) => r.hcp_job_id).filter(Boolean))] as string[];
  const nameByCust = new Map<string, string>();
  const custByJob = new Map<string, { cid: string; name: string }>();
  if (custIds.length) {
    const { data: cs } = await supa.from("customer_360").select("hcp_customer_id, name").in("hcp_customer_id", custIds);
    (cs ?? []).forEach((c: any) => nameByCust.set(c.hcp_customer_id, c.name));
  }
  if (jobIds.length) {
    const { data: js } = await supa.from("job_360").select("hcp_job_id, hcp_customer_id, customer_name").in("hcp_job_id", jobIds);
    (js ?? []).forEach((j: any) => custByJob.set(j.hcp_job_id, { cid: j.hcp_customer_id, name: j.customer_name }));
  }

  return rows.map((r) => {
    const fromJob = r.hcp_job_id ? custByJob.get(r.hcp_job_id) : undefined;
    return {
      capture_type: r.capture_type, capture_id: r.capture_id, subtype: r.subtype,
      title: r.title ?? "", snippet: (r.body_text ?? "").replace(/\s+/g, " ").trim().slice(0, 220),
      body_len: (r.body_text ?? "").length,
      hcp_customer_id: r.hcp_customer_id ?? fromJob?.cid ?? null,
      hcp_job_id: r.hcp_job_id ?? null,
      customer_name: r.customer_name ?? (r.hcp_customer_id ? nameByCust.get(r.hcp_customer_id) ?? null : null) ?? fromJob?.name ?? null,
      tech: r.tech, occurred_at: r.occurred_at, media_kind: r.media_kind, media_url: r.media_url, status: r.status,
    };
  });
}

// Signed URL for playing a recording from the private bucket (reuses the
// canonical helper so the bucket name + lookup live in one place).
export async function captureAudioUrl(recordingId: string): Promise<string | null> {
  if (!(await gate())) return null;
  const res = await getRecordingSignedUrl(recordingId);
  return res.ok ? res.url : null;
}

export type GenerateFromCapturesResult = (BasedOnResult & { hcpCustomerId?: string }) | { ok: false; error: string };

export async function generateFromCaptures(keys: Array<{ t: string; id: string }>): Promise<GenerateFromCapturesResult> {
  // Generating an estimate is a WRITE — gate on writer authority (owner/tech),
  // not the wider read gate, so managers get a clean upfront rejection instead
  // of a confusing failure after all the work (matches generateBasedOnEstimate).
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };
  if (!keys.length) return { ok: false, error: "select at least one capture" };
  const supa = db();
  // Filter on the globally-unique capture_key ('type:id') so a bigint comm id
  // can't over-fetch a same-numbered photo row (and vice-versa).
  const compositeKeys = keys.map((k) => `${k.t}:${k.id}`);
  const { data } = await supa.from("captures_search_v").select("*").in("capture_key", compositeKeys);
  const rows = (data ?? []) as Array<Record<string, any>>;
  if (!rows.length) return { ok: false, error: "selected captures not found" };

  // Resolve the effective customer per row, then REJECT a selection that spans
  // more than one customer — otherwise customer B's text/photos would be folded
  // into an estimate scoped to customer A.
  const jobIds = [...new Set(rows.map((r) => r.hcp_job_id).filter(Boolean))] as string[];
  const custByJob = new Map<string, string>();
  if (jobIds.length) {
    const { data: js } = await supa.from("job_360").select("hcp_job_id, hcp_customer_id").in("hcp_job_id", jobIds);
    (js ?? []).forEach((j: any) => custByJob.set(j.hcp_job_id, j.hcp_customer_id));
  }
  const cidOf = (r: Record<string, any>): string | null =>
    (r.hcp_customer_id as string | null) ?? (r.hcp_job_id ? custByJob.get(r.hcp_job_id) ?? null : null);
  const distinctCids = [...new Set(rows.map(cidOf).filter(Boolean))] as string[];
  if (distinctCids.length > 1) {
    return { ok: false, error: "Selected captures span multiple customers — pick captures from a single customer or job." };
  }
  const cid = distinctCids[0] ?? null;
  if (!cid) return { ok: false, error: "These captures aren't tied to a customer — pick captures from a customer/job, or start from the estimate page." };
  // Only auto-pull a job's 360 when the selection points at exactly one job.
  const jobId = jobIds.length === 1 ? jobIds[0] : null;

  // Assemble into one reference blob + photo URLs, capping each part + the total
  // so long call transcripts can't blow the generator's context window.
  const PER_PART = 6000;
  const TOTAL = 60000;
  const textParts: string[] = [];
  const imageUrls: string[] = [];
  for (const r of rows) {
    if (r.media_kind === "image" && r.media_url) imageUrls.push(r.media_url);
    const body = r.body_text ? String(r.body_text).trim() : "";
    if (body) {
      textParts.push(`[${r.capture_type}${r.subtype ? "/" + r.subtype : ""}${r.occurred_at ? " " + String(r.occurred_at).slice(0, 10) : ""}] ${body.slice(0, PER_PART)}`);
    }
  }
  let freeform = textParts.join("\n\n");
  if (freeform.length > TOTAL) freeform = freeform.slice(0, TOTAL) + "\n\n[…truncated — selection too large; narrow your picks]";
  if (!freeform && !imageUrls.length) return { ok: false, error: "nothing usable in the selection" };

  const res = await generateBasedOnEstimate(cid, {
    freeform: freeform || undefined,
    uploadedImageUrls: imageUrls,
    jobId: jobId || undefined,
    includeJob360: !!jobId,
  });
  return res.ok ? { ...res, hcpCustomerId: cid } : res;
}
