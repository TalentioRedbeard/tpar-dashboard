"use server";

// Gallery data layer (Danny 2026-06-15). Resolves a scope (job / customer / estimate /
// segment) to its invoice trunk(s), then reuses getJobMedia (Drive) to list photos.
// Photos live in Google Drive keyed by the invoice trunk, so no new edge fn is needed.
// NOTE: Drive exposes thumbnail + viewer links only (no direct-download URL) — bulk/ZIP
// download + local thumbnail caching are a v1.1 (need the Drive API).

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { getJobMedia, type MediaFile } from "@/lib/job-media-actions";

export type GalleryScope = "job" | "customer" | "estimate" | "segment";
export type GalleryPhoto = MediaFile & { trunk: string; folderLabel: string };
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
        photos.push({ ...file, trunk: t, folderLabel: f.day_number ? `#${t} · Day ${f.day_number}` : `#${t}` });
      }
    }
  }
  // Newest first when Drive gave us a createdTime.
  photos.sort((a, b) => String(b.createdTime ?? "").localeCompare(String(a.createdTime ?? "")));
  return { ok: true, photos, trunks, capped: allTrunks.length > trunks.length };
}
