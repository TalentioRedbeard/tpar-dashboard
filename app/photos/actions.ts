"use server";

// Server actions for the web /photos upload flow (job photos + videos).
// Mirrors the Slack /job-media flow.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type UploadJobMediaResult =
  | { ok: true; photo_id: number; photo_url: string }
  | { ok: false; error: string };

export async function uploadJobMedia(formData: FormData): Promise<UploadJobMediaResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite) return { ok: false, error: "Not signed in or no write access." };

  const photo = formData.get("photo") as File | null;
  const hcpJobId = (formData.get("hcp_job_id") as string | null)?.trim() || null;
  const subject = (formData.get("primary_subject") as string | null)?.trim() || null;
  const notes = (formData.get("notes") as string | null)?.trim() || null;

  if (!photo || photo.size === 0) return { ok: false, error: "Photo is required." };
  if (!hcpJobId) return { ok: false, error: "Job is required (so the photo gets attached)." };

  const supabase = db();

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = photo.name.split(".").pop()?.toLowerCase() || "jpg";
  const submitter = me.tech?.tech_short_name ?? me.email;
  const path = `jobs/${hcpJobId}/${ts}-${submitter}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("job-photos")
    .upload(path, photo, { contentType: photo.type, upsert: false });
  if (uploadErr) return { ok: false, error: `Upload failed: ${uploadErr.message}` };

  const { data: publicUrl } = supabase.storage.from("job-photos").getPublicUrl(path);

  const { data: row, error: insErr } = await supabase
    .from("photo_labels")
    .insert({
      source: "dashboard",
      source_id: `dashboard-${Date.now()}`,
      hcp_job_id: hcpJobId,
      photo_url: publicUrl.publicUrl,
      primary_subject: subject,
      labels: notes ? { notes } : {},
    })
    .select("id")
    .single();

  if (insErr || !row) return { ok: false, error: insErr?.message ?? "Insert failed" };

  revalidatePath("/photos");
  revalidatePath(`/job/${hcpJobId}`);
  return { ok: true, photo_id: row.id as number, photo_url: publicUrl.publicUrl };
}

export type RecentJobOption = { hcp_job_id: string; customer_name: string | null; job_date: string | null };

export async function getRecentJobs(opts: { mine?: boolean; limit?: number } = {}): Promise<RecentJobOption[]> {
  const me = await getCurrentTech();
  if (!me) return [];
  const supabase = db();
  const limit = opts.limit ?? 25;
  const sinceDate = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  // For techs, scope to their jobs only (privacy). Admin/manager see all.
  let query = supabase
    .from("job_360")
    .select("hcp_job_id, customer_name, job_date, tech_primary_name, tech_all_names")
    .gte("job_date", sinceDate)
    .order("job_date", { ascending: false })
    .limit(limit);

  if (me.dashboardRole === "tech" && me.tech) {
    query = query.or(`tech_primary_name.eq.${me.tech.tech_short_name},tech_all_names.cs.{${me.tech.tech_short_name}}`);
  }

  const { data } = await query;
  return (data ?? []).map((j: any) => ({
    hcp_job_id: j.hcp_job_id,
    customer_name: j.customer_name,
    job_date: j.job_date,
  }));
}
