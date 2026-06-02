"use server";

// #31 — job media gallery. Lists the job's Google Drive media (photos + videos)
// via the job-media-list edge fn. Returns Drive thumbnail + view links only —
// no blobs stored, no Postgres load. Fetched lazily by the gallery component.

import { getCurrentTech } from "@/lib/current-tech";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type MediaFile = {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  webViewLink?: string;
  createdTime?: string;
};
export type MediaFolder = {
  drive_folder_id: string;
  drive_web_link: string;
  day_number: number | null;
  file_count: number;
  error: string | null;
  files: MediaFile[];
};

export async function getJobMedia(invoiceTrunk: string): Promise<{ ok: boolean; folders?: MediaFolder[]; error?: string }> {
  // Any signed-in tech/manager/owner who reached the (already scope-gated) job page.
  const me = await getCurrentTech().catch(() => null);
  if (!me) return { ok: false, error: "unauthorized" };
  if (!invoiceTrunk) return { ok: true, folders: [] };
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, error: "server misconfigured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/job-media-list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ invoice_trunk: invoiceTrunk }),
    });
    const j = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !j?.ok) return { ok: false, error: String(j?.error ?? `job-media-list ${res.status}`) };
    return { ok: true, folders: (j.folders ?? []) as MediaFolder[] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
