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

// Sign a drive-zip URL for the selected file ids → one streamed ZIP download. Generated
// on click (the selection is client-side), 1h expiry. Matches drive-zip's HMAC (`${ids}:${exp}`).
export async function signGalleryZipUrl(fileIds: string[]): Promise<string | null> {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return null;
  const ids = fileIds.filter(Boolean).slice(0, 80);
  if (ids.length === 0 || !PROXY_BASE || !PROXY_SECRET) return null;
  const idsCsv = ids.join(",");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = crypto.createHmac("sha256", PROXY_SECRET).update(`${idsCsv}:${exp}`).digest("hex");
  const p = new URLSearchParams({ ids: idsCsv, exp: String(exp), sig, name: "tpar-photos.zip" });
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
};
export type GalleryResult =
  | { ok: true; photos: GalleryPhoto[]; trunks: string[]; capped: boolean }
  | { ok: false; error: string };

const TRUNK_CAP = 12; // don't hammer Drive for a huge customer; note it in the UI

function trunkOf(invoice: string | null | undefined): string | null {
  const t = String(invoice ?? "").split("-")[0].trim();
  return t || null;
}

async function trunksForScope(scope: GalleryScope, id: string): Promise<string[]> {
  const supa = db();
  if (scope === "job" || scope === "segment") {
    const { data } = await supa.from("job_360").select("invoice_number").eq("hcp_job_id", id).maybeSingle();
    const t = trunkOf((data as { invoice_number?: string | null } | null)?.invoice_number);
    return t ? [t] : [];
  }
  if (scope === "estimate") {
    const { data: links } = await supa.from("job_estimate_links").select("hcp_job_id").eq("hcp_estimate_id", id);
    const jobIds = ((links ?? []) as Array<{ hcp_job_id: string | null }>).map((r) => r.hcp_job_id).filter((x): x is string => !!x);
    if (jobIds.length === 0) return [];
    const { data: jobs } = await supa.from("job_360").select("invoice_number").in("hcp_job_id", jobIds);
    return Array.from(new Set(((jobs ?? []) as Array<{ invoice_number: string | null }>).map((r) => trunkOf(r.invoice_number)).filter((x): x is string => !!x)));
  }
  // customer
  const { data } = await supa.from("job_360").select("invoice_number").eq("hcp_customer_id", id);
  return Array.from(new Set(((data ?? []) as Array<{ invoice_number: string | null }>).map((r) => trunkOf(r.invoice_number)).filter((x): x is string => !!x)));
}

export async function getGalleryPhotos(scope: GalleryScope, id: string): Promise<GalleryResult> {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return { ok: false, error: "unauthorized" };
  if (!id) return { ok: false, error: "missing id" };

  const allTrunks = await trunksForScope(scope, id);
  if (allTrunks.length === 0) return { ok: true, photos: [], trunks: [], capped: false };
  const trunks = allTrunks.slice(0, TRUNK_CAP);

  // Fetch each trunk's Drive media in parallel (capped above), then flatten.
  const results = await Promise.all(trunks.map((t) => getJobMedia(t).then((r) => ({ t, r }))));
  const photos: GalleryPhoto[] = [];
  for (const { t, r } of results) {
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
  // Newest first when Drive gave us a createdTime.
  photos.sort((a, b) => String(b.createdTime ?? "").localeCompare(String(a.createdTime ?? "")));
  return { ok: true, photos, trunks, capped: allTrunks.length > trunks.length };
}
