"use server";

// Gallery data layer (Danny 2026-06-15). Resolves a scope (job / customer / estimate /
// segment) to its invoice trunk(s), then reuses getJobMedia (Drive) to list photos.
// Photos live in Google Drive keyed by the invoice trunk, so no new edge fn is needed.
// NOTE: Drive exposes thumbnail + viewer links only (no direct-download URL) — bulk/ZIP
// download + local thumbnail caching are a v1.1 (need the Drive API).

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { getJobMedia, type MediaFile } from "@/lib/job-media-actions";
import crypto from "node:crypto";

// drive-media proxy signing — serves Drive media to ANY tech (no personal Google session).
const PROXY_BASE = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const PROXY_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PROXY_TTL_SEC = 7 * 24 * 3600; // 7d — comfortably outstays the 1h list cache

function biggerThumb(url?: string): string | undefined {
  if (!url) return url;
  return url.replace(/=s\d+(-c)?$/, "=s1600");
}

// Sign a drive-zip URL for the selected photos → one streamed ZIP download. Drive photos
// go by file id; Storage photos (HCP backfill / in-app uploads) go by their bucket path
// (derived from the public URL). Generated on click (selection is client-side), 1h expiry.
// Matches drive-zip's HMAC (`${ids}:${paths}:${exp}`).
const STORAGE_MARKER = "/object/public/job-photos/";
export async function signGalleryZipUrl(items: Array<{ id: string; storageUrl?: string }>): Promise<string | null> {
  const me = await getCurrentTech().catch(() => null);
  if (!me || !PROXY_BASE || !PROXY_SECRET) return null;
  const driveIds: string[] = [];
  const storagePaths: string[] = [];
  for (const it of items.slice(0, 80)) {
    if (it.storageUrl) {
      const path = it.storageUrl.split(STORAGE_MARKER)[1];
      if (path) storagePaths.push(path);
    } else if (it.id) {
      driveIds.push(it.id);
    }
  }
  if (driveIds.length + storagePaths.length === 0) return null;
  const idsCsv = driveIds.join(",");
  const pathsCsv = storagePaths.join(",");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = crypto.createHmac("sha256", PROXY_SECRET).update(`${idsCsv}:${pathsCsv}:${exp}`).digest("hex");
  const p = new URLSearchParams({ exp: String(exp), sig, name: "tpar-photos.zip" });
  if (idsCsv) p.set("ids", idsCsv);
  if (pathsCsv) p.set("paths", pathsCsv);
  return `${PROXY_BASE}/functions/v1/drive-zip?${p.toString()}`;
}

// Chooser for the top-nav "Gallery" landing (no scope/id yet): search a job (by invoice
// or customer name) or a customer to open their photos. Tech-scoped: techs only get jobs
// they were on; customer-wide is office-only.
export type GalleryTarget = { kind: "job" | "customer"; id: string; label: string; sub: string };
export async function searchGalleryTargets(query: string): Promise<GalleryTarget[]> {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return [];
  const safe = query.replace(/[,()*%]/g, " ").trim();
  if (safe.length < 2) return [];
  const isOffice = !!(me.isAdmin || me.isManager);
  const myName = me.tech?.hcp_full_name ?? null;
  const supa = db();
  const out: GalleryTarget[] = [];

  const { data: jobs } = await supa
    .from("job_360")
    .select("hcp_job_id, invoice_number, customer_name, tech_primary_name, tech_all_names, job_date")
    .or(`invoice_number.ilike.%${safe}%,customer_name.ilike.%${safe}%`)
    .order("job_date", { ascending: false, nullsFirst: false })
    .limit(20);
  for (const j of (jobs ?? []) as Array<Record<string, unknown>>) {
    if (!isOffice) {
      const crew = [j.tech_primary_name as string | null, ...(((j.tech_all_names as string[] | null) ?? []))].filter(Boolean) as string[];
      if (!myName || !crew.includes(myName)) continue; // techs only see their own jobs
    }
    out.push({
      kind: "job",
      id: j.hcp_job_id as string,
      label: (j.customer_name as string | null) ?? (j.invoice_number as string | null) ?? (j.hcp_job_id as string),
      sub: `job · #${(j.invoice_number as string | null) ?? "?"}${j.job_date ? " · " + (j.job_date as string) : ""}`,
    });
    if (out.length >= 15) break;
  }

  if (isOffice) {
    const { data: custs } = await supa
      .from("customer_360")
      .select("hcp_customer_id, name")
      .ilike("name", `%${safe}%`)
      .limit(8);
    for (const c of (custs ?? []) as Array<Record<string, unknown>>) {
      out.push({ kind: "customer", id: c.hcp_customer_id as string, label: (c.name as string | null) ?? (c.hcp_customer_id as string), sub: "customer · all jobs" });
    }
  }
  return out.slice(0, 22);
}

// HMAC-signed drive-media URL (matches the edge fn: service key, `id:mode:exp`).
function signProxy(id: string, mode: "thumb" | "download", opts: { name?: string; thumb?: string }): string | undefined {
  if (!PROXY_BASE || !PROXY_SECRET || !id) return undefined;
  const exp = Math.floor(Date.now() / 1000) + PROXY_TTL_SEC;
  const sig = crypto.createHmac("sha256", PROXY_SECRET).update(`${id}:${mode}:${exp}`).digest("hex");
  const p = new URLSearchParams({ id, mode, exp: String(exp), sig });
  if (opts.name) p.set("name", opts.name);
  if (opts.thumb) p.set("t", opts.thumb);
  return `${PROXY_BASE}/functions/v1/drive-media?${p.toString()}`;
}

export type GalleryScope = "job" | "customer" | "estimate" | "segment";
export type GalleryPhoto = MediaFile & {
  trunk: string;
  folderLabel: string;
  thumbProxyUrl?: string;    // grid thumbnail via drive-media (renders for any tech)
  lightboxProxyUrl?: string; // larger view via drive-media
  downloadProxyUrl?: string; // full-file download via drive-media
  storageUrl?: string;       // set for Supabase-Storage photos (HCP backfill + in-app uploads);
                             // a direct public URL — not a Drive file, so it bypasses drive-zip.
};
export type GalleryResult =
  | { ok: true; photos: GalleryPhoto[]; trunks: string[]; capped: boolean }
  | { ok: false; error: string };

const TRUNK_CAP = 12; // don't hammer Drive for a huge customer; note it in the UI

function trunkOf(invoice: string | null | undefined): string | null {
  const t = String(invoice ?? "").split("-")[0].trim();
  return t || null;
}

// P1 (2026-06-17): resolve an HCP estimate id → its customer. job_estimate_links
// is effectively empty (estimate scope returned nothing), so we read the customer
// off hcp_estimates_raw and fan out to that customer's jobs.
async function customerForEstimate(estimateId: string): Promise<string | null> {
  const { data } = await db().from("hcp_estimates_raw").select("hcp_customer_id").eq("hcp_estimate_id", estimateId).maybeSingle();
  return (data as { hcp_customer_id?: string | null } | null)?.hcp_customer_id ?? null;
}

// P0 (2026-06-17): photo resolution reads jobs_master (full 8,222-job history),
// NOT job_360 (a ~3-month / 366-job analytics view that hid ~93% of backfilled
// photos). jobs_master uses hcp_invoice_number (not invoice_number). The
// `not hcp_job_id is null` guard skips the 2,562 NULL-hcp_job_id legacy rows.
async function trunksForScope(scope: GalleryScope, id: string): Promise<string[]> {
  const supa = db();
  if (scope === "job" || scope === "segment") {
    const { data } = await supa.from("jobs_master").select("hcp_invoice_number").eq("hcp_job_id", id).maybeSingle();
    const t = trunkOf((data as { hcp_invoice_number?: string | null } | null)?.hcp_invoice_number);
    return t ? [t] : [];
  }
  if (scope === "estimate") {
    const custId = await customerForEstimate(id);
    if (!custId) return [];
    const { data: jobs } = await supa.from("jobs_master").select("hcp_invoice_number").eq("hcp_customer_id", custId).not("hcp_job_id", "is", null);
    return Array.from(new Set(((jobs ?? []) as Array<{ hcp_invoice_number: string | null }>).map((r) => trunkOf(r.hcp_invoice_number)).filter((x): x is string => !!x)));
  }
  // customer — full job history (jobs_master), not the windowed job_360 view
  const { data } = await supa.from("jobs_master").select("hcp_invoice_number").eq("hcp_customer_id", id).not("hcp_job_id", "is", null);
  return Array.from(new Set(((data ?? []) as Array<{ hcp_invoice_number: string | null }>).map((r) => trunkOf(r.hcp_invoice_number)).filter((x): x is string => !!x)));
}

// The job ids a scope covers — for the Storage-backed photos (photo_labels is keyed by
// hcp_job_id, not by invoice trunk). Parallels trunksForScope.
async function jobIdsForScope(scope: GalleryScope, id: string): Promise<string[]> {
  const supa = db();
  if (scope === "job" || scope === "segment") return [id];
  if (scope === "estimate") {
    const custId = await customerForEstimate(id);
    if (!custId) return [];
    const { data } = await supa.from("jobs_master").select("hcp_job_id").eq("hcp_customer_id", custId).not("hcp_job_id", "is", null);
    return ((data ?? []) as Array<{ hcp_job_id: string | null }>).map((r) => r.hcp_job_id).filter((x): x is string => !!x);
  }
  // customer — full job history (jobs_master), not the windowed job_360 view
  const { data } = await supa.from("jobs_master").select("hcp_job_id").eq("hcp_customer_id", id).not("hcp_job_id", "is", null);
  return ((data ?? []) as Array<{ hcp_job_id: string | null }>).map((r) => r.hcp_job_id).filter((x): x is string => !!x);
}

const JOBS_CAP = 1000; // bound the IN() for a huge customer (raised from 200 — Equitable has 211 jobs; 2026-06-17)

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "heic"].includes(ext)) return `image/${ext === "jpg" ? "jpeg" : ext}`;
  if (["mp4", "mov", "webm", "m4v"].includes(ext)) return `video/${ext}`;
  return "application/octet-stream";
}

// Storage-backed photos (photo_labels → public job-photos bucket): the HCP backfill
// (source='hcp') AND the in-app/Slack uploads. These are direct public URLs, so the proxy
// fields just point straight at the file (no drive-media needed).
async function storagePhotosForJobs(jobIds: string[]): Promise<GalleryPhoto[]> {
  if (jobIds.length === 0) return [];
  const supa = db();
  const { data } = await supa
    .from("photo_labels")
    .select("id, source, source_id, hcp_job_id, photo_url, primary_subject, labels, created_at")
    .in("hcp_job_id", jobIds.slice(0, JOBS_CAP))
    .not("photo_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);
  const out: GalleryPhoto[] = [];
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const url = r.photo_url as string;
    const labels = (r.labels as Record<string, unknown> | null) ?? {};
    const name = (labels.file_name as string | null) ?? url.split("/").pop()?.split("?")[0] ?? "photo";
    const mime = (labels.file_type as string | null) ?? mimeFromName(name);
    const src = (r.source as string | null) ?? "";
    out.push({
      id: `pl-${r.id}`,
      name,
      mimeType: mime,
      thumbnailLink: url,
      webViewLink: url,
      createdTime: (r.created_at as string | null) ?? undefined,
      trunk: "",
      folderLabel: src === "hcp" ? "Housecall Pro" : src === "slack_job_media" ? "Slack" : src === "dashboard" ? "App upload" : "Photo",
      thumbProxyUrl: url,
      lightboxProxyUrl: url,
      downloadProxyUrl: url,
      storageUrl: url,
    });
  }
  return out;
}

export async function getGalleryPhotos(scope: GalleryScope, id: string): Promise<GalleryResult> {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return { ok: false, error: "unauthorized" };
  if (!id) return { ok: false, error: "missing id" };

  // Two sources, fetched in parallel: Google Drive (Slack #job-media → Drive, keyed by
  // invoice trunk) and Supabase Storage (HCP photo backfill + in-app uploads, keyed by
  // hcp_job_id via photo_labels). A job can have photos in either or both.
  const [allTrunks, jobIds] = await Promise.all([trunksForScope(scope, id), jobIdsForScope(scope, id)]);
  const trunks = allTrunks.slice(0, TRUNK_CAP);

  const [driveResults, storagePhotos] = await Promise.all([
    Promise.all(trunks.map((t) => getJobMedia(t).then((r) => ({ t, r })))),
    storagePhotosForJobs(jobIds),
  ]);

  const photos: GalleryPhoto[] = [];
  for (const { t, r } of driveResults) {
    if (!r.ok || !r.folders) continue;
    for (const f of r.folders) {
      for (const file of f.files) {
        const fid = String(file.id);
        photos.push({
          ...file,
          trunk: t,
          folderLabel: f.day_number ? `#${t} · Day ${f.day_number}` : `#${t}`,
          thumbProxyUrl: file.thumbnailLink ? signProxy(fid, "thumb", { thumb: file.thumbnailLink }) : undefined,
          lightboxProxyUrl: file.thumbnailLink ? signProxy(fid, "thumb", { thumb: biggerThumb(file.thumbnailLink) }) : undefined,
          downloadProxyUrl: signProxy(fid, "download", { name: file.name }),
        });
      }
    }
  }
  photos.push(...storagePhotos);

  // Newest first when we have a createdTime.
  photos.sort((a, b) => String(b.createdTime ?? "").localeCompare(String(a.createdTime ?? "")));
  return { ok: true, photos, trunks, capped: allTrunks.length > trunks.length };
}
