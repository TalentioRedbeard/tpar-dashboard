"use server";

// Studio ("Based on…" station) — search every capture in the system
// (recordings, notes, comms, photos) and build an estimate draft from any
// selection. Spine = captures_search_v. (G — Danny 2026-06-04.)

import { revalidatePath } from "next/cache";
import { db } from "./supabase";
import { getCurrentTech, requireWriter } from "./current-tech";
import { getRecordingSignedUrl, resolveJobRef } from "./recordings";
import { generateBasedOnEstimate, type BasedOnResult, type BasedOnDraftOption } from "./based-on-actions";
import { createMultiOptionEstimate } from "./multi-option-estimate-actions";
import { linePriceCents, materialsCostCents, isGarbageNumeric } from "./estimate-pricing";

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

export type SearchFilters = { customerId?: string; since?: string; until?: string };

// Resolve a YYYY-MM-DD picked in the date filters to the matching Central-time
// instant (the DB session is UTC and occurred_at is timestamptz, so a naive
// literal would shift the window ~6h and drop evening captures). DST-safe via
// Intl, independent of the server's own timezone.
function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
  const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return (asUTC - date.getTime()) / 60000;
}
function centralDayBoundary(ymd: string, end: boolean): string {
  const guess = new Date(`${ymd}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
  const off = zoneOffsetMinutes(guess, "America/Chicago");
  return new Date(guess.getTime() - off * 60000).toISOString();
}

export async function searchCaptures(query: string, type?: string, filters?: SearchFilters): Promise<Capture[]> {
  if (!(await gate())) return [];
  const supa = db();
  let q = supa.from("captures_search_v").select("*").order("occurred_at", { ascending: false }).limit(60);
  if (type && type !== "all") q = q.eq("capture_type", type);
  if (filters?.since) q = q.gte("occurred_at", centralDayBoundary(filters.since, false));
  if (filters?.until) q = q.lte("occurred_at", centralDayBoundary(filters.until, true));
  if (filters?.customerId) {
    const cid = filters.customerId;
    // HCP customer ids are cus_<hex>; reject anything else so a stray comma/paren
    // can't split the PostgREST .or() expression (the term path is scrubbed; ids weren't).
    if (!/^cus_[0-9a-z]+$/i.test(cid)) return [];
    // Include captures tied directly to the customer OR to any of their jobs
    // (job-scoped notes/photos/comms have hcp_job_id, not hcp_customer_id).
    const { data: jobs } = await supa.from("job_360").select("hcp_job_id").eq("hcp_customer_id", cid).limit(200);
    const jobIds = ((jobs ?? []) as Array<{ hcp_job_id: string }>)
      .map((j) => j.hcp_job_id)
      .filter((id): id is string => /^job_[0-9a-z]+$/i.test(id));
    q = jobIds.length
      ? q.or(`hcp_customer_id.eq.${cid},hcp_job_id.in.(${jobIds.join(",")})`)
      : q.eq("hcp_customer_id", cid);
  }
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

export type AttachResult =
  | { ok: true; hcp_job_id: string; label: string }
  | { ok: false; error: string; matches?: Array<{ hcp_job_id: string; label: string }> };

// Re-point an orphaned/mis-targeted recording at a job from the station — the
// original lost-Cantrell-recording fix. Routes the typed input through the
// shared resolver (BLOCKS on the shared-invoice ambiguity landmine) so a number
// never silently lands on the wrong job. Only recordings have a mutable target.
// Leadership-gated (admin || manager) to match the station — NOT requireResolver
// (which would let a tech re-point any recording via a direct server-action POST,
// since the page redirect doesn't protect the action).
export async function attachCaptureToJob(recordingId: string, jobInput: string): Promise<AttachResult> {
  if (!(await gate())) return { ok: false, error: "Not authorized." };
  const res = await resolveJobRef(jobInput);
  if (!res.ok) return res;
  const supa = db();
  const { error } = await supa
    .from("recordings")
    .update({ target_kind: "job", target_ref: res.hcp_job_id })
    .eq("id", recordingId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/studio");
  return { ok: true, hcp_job_id: res.hcp_job_id, label: res.label };
}

export type GenerateFromCapturesResult =
  | (Extract<BasedOnResult, { ok: true }> & { hcpCustomerId: string; hcpJobId?: string })
  | { ok: false; error: string };

export async function generateFromCaptures(
  keys: Array<{ t: string; id: string }>,
  uploadedImageUrls?: string[],
): Promise<GenerateFromCapturesResult> {
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
  // Photos uploaded from the operator's computer in Studio (same path the
  // Based-on panel uses) ride along with the selected captures' photos.
  if (uploadedImageUrls?.length) imageUrls.push(...uploadedImageUrls.filter((u) => typeof u === "string" && !!u));
  let freeform = textParts.join("\n\n");
  if (freeform.length > TOTAL) freeform = freeform.slice(0, TOTAL) + "\n\n[…truncated — selection too large; narrow your picks]";
  if (!freeform && !imageUrls.length) return { ok: false, error: "nothing usable in the selection" };

  const res = await generateBasedOnEstimate(cid, {
    freeform: freeform || undefined,
    uploadedImageUrls: imageUrls,
    jobId: jobId || undefined,
    includeJob360: !!jobId,
  });
  return res.ok ? { ...res, hcpCustomerId: cid, hcpJobId: jobId ?? undefined } : res;
}

export type PushDraftResult =
  | { ok: true; estimate_id: string; estimate_number: string; hcp_url: string | null; warning?: string }
  | { ok: false; error: string };

// Push a generated studio draft straight to HCP — closes the loop without a
// detour through the estimate builder. Prices each line with the SHARED pricing
// helper (cents, incl. the materials cost basis), inherits the assigned tech +
// address, and delegates to createMultiOptionEstimate (which also writes the
// job↔estimate link). Returns a warning when the tech had to be guessed/omitted.
export async function pushStudioDraft(
  options: BasedOnDraftOption[],
  hcpCustomerId: string,
  hcpJobId?: string,
): Promise<PushDraftResult> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };
  if (!hcpCustomerId || !hcpCustomerId.startsWith("cus_")) return { ok: false, error: "A valid customer is required." };
  if (!options?.length) return { ok: false, error: "No options to push." };

  // Guard a typo'd numeric field from silently pricing a named line to $0 in a
  // REAL estimate (empty is fine — that's an intentional $0).
  const suspect = options.flatMap((o) => o.lines ?? []).find(
    (ln) => ln.name && ln.name.trim() && (isGarbageNumeric(ln.hours) || isGarbageNumeric(ln.crew) || isGarbageNumeric(ln.materials)),
  );
  if (suspect) {
    return { ok: false, error: `Check pricing — "${suspect.name.trim()}" has an unreadable hours/crew/materials value and would price to $0. Fix it or clear the field.` };
  }

  const supa = db();
  const pickTechAddr = (raw: Record<string, any>): { ids: string[]; addr?: string } => ({
    ids: Array.isArray(raw.assigned_employees)
      ? raw.assigned_employees.map((e: any) => e?.id).filter((s: any): s is string => typeof s === "string" && !!s)
      : [],
    addr: raw.address?.id ?? undefined,
  });

  // Inherit the assigned tech(s) + address — from the job when the draft points
  // at one, otherwise the customer's most-recent non-deleted job so the REAL
  // estimate isn't pushed tech-less (the HCP "drops the tech" landmine). The
  // deleted_at guard avoids soft-deleted zombie jobs.
  let assignedEmployeeIds: string[] = [];
  let addressId: string | undefined;
  let techFromFallback = false;
  if (hcpJobId) {
    const { data: job } = await supa.from("hcp_jobs_raw").select("raw").eq("hcp_job_id", hcpJobId).is("deleted_at", null).maybeSingle();
    const picked = pickTechAddr((job?.raw ?? {}) as Record<string, any>);
    assignedEmployeeIds = picked.ids;
    addressId = picked.addr;
  }
  if (!assignedEmployeeIds.length) {
    const { data: jobs } = await supa
      .from("hcp_jobs_raw")
      .select("raw")
      .eq("hcp_customer_id", hcpCustomerId)
      .is("deleted_at", null)
      .order("scheduled_start", { ascending: false, nullsFirst: false })
      .limit(20);
    for (const j of (jobs ?? []) as Array<{ raw: Record<string, any> }>) {
      const picked = pickTechAddr(j.raw ?? {});
      if (picked.ids.length && !assignedEmployeeIds.length) { assignedEmployeeIds = picked.ids; techFromFallback = true; }
      if (!addressId && picked.addr) addressId = picked.addr;
      if (assignedEmployeeIds.length && addressId) break;
    }
  }

  const estOptions = options.map((o, i) => ({
    name: o.name || `Option ${i + 1}`,
    line_items: (o.lines ?? [])
      .filter((ln) => ln.name && ln.name.trim())
      .map((ln) => ({
        name: ln.name.trim(),
        quantity: 1,
        unit_price_cents: linePriceCents(ln.hours, ln.crew, ln.materials),
        unit_cost_cents: materialsCostCents(ln.materials),
        ...(ln.description && ln.description.trim() ? { description: ln.description.trim() } : {}),
      })),
  }));

  const res = await createMultiOptionEstimate({
    hcpCustomerId,
    addressId,
    assignedEmployeeIds: assignedEmployeeIds.length ? assignedEmployeeIds : undefined,
    hcpJobId,
    options: estOptions,
  });
  if (!res.ok) return res;
  const warning = !assignedEmployeeIds.length
    ? "No technician was attached — assign one in HCP."
    : techFromFallback
      ? "Technician inherited from the customer's most recent job — verify it in HCP."
      : undefined;
  return { ...res, warning };
}
