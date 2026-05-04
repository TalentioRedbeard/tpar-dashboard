"use server";

// Server actions for the SalesAsk recording manual-review UX (#126).
// Lets admin/manager confirm uncertain auto-bindings, re-link to a different
// job, or mark a recording as unbound (e.g., test recordings).

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type RecordingRow = {
  id: string;
  recording_name: string | null;
  recorded_at: string | null;
  duration_sec: number | null;
  url_mp3: string | null;
  uid: string | null;                       // lead tech's SalesAsk uid
  hcp_job_id: string | null;
  hcp_customer_id: string | null;
  match_method: string | null;
  match_confidence: number | null;
  bound_at: string | null;
  scope_notes: string | null;
  pricing_notes: string | null;
};

export type CandidateJob = {
  hcp_job_id: string;
  customer_name: string | null;
  job_date: string | null;
  tech_primary_name: string | null;
};

async function requireLeadership(): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "Not signed in." };
  if (!me.isAdmin && !me.isManager) return { ok: false, error: "Admin or manager only." };
  return { ok: true, email: me.email };
}

export async function getRecordings(): Promise<RecordingRow[]> {
  const auth = await requireLeadership();
  if (!auth.ok) return [];
  const supabase = db();
  const { data } = await supabase
    .from("salesask_recordings")
    .select("id, recording_name, recorded_at, duration_sec, url_mp3, uid, hcp_job_id, hcp_customer_id, match_method, match_confidence, bound_at, scope_notes, pricing_notes")
    .order("match_confidence", { ascending: true, nullsFirst: false })
    .order("recorded_at", { ascending: false })
    .limit(100);
  return (data ?? []) as RecordingRow[];
}

export async function getCandidateJobsForRecording(recording_id: string): Promise<CandidateJob[]> {
  const auth = await requireLeadership();
  if (!auth.ok) return [];
  const supabase = db();

  // Look up the recording's uid → that uid's lead tech → their recent jobs
  const { data: rec } = await supabase
    .from("salesask_recordings")
    .select("uid, recorded_at")
    .eq("id", recording_id)
    .maybeSingle();
  if (!rec?.uid) return [];

  const { data: tech } = await supabase
    .from("tech_directory")
    .select("hcp_full_name, tech_short_name")
    .eq("salesask_uid", rec.uid)
    .maybeSingle();
  if (!tech?.hcp_full_name) return [];

  const recordedTs = rec.recorded_at ? new Date(rec.recorded_at as string).getTime() : Date.now();
  const startWindow = new Date(recordedTs - 14 * 86400_000).toISOString();
  const endWindow = new Date(recordedTs + 14 * 86400_000).toISOString();

  const { data: candidates } = await supabase
    .from("job_360")
    .select("hcp_job_id, customer_name, job_date, tech_primary_name")
    .or(`tech_primary_name.eq.${tech.hcp_full_name},tech_all_names.cs.{${tech.hcp_full_name}}`)
    .gte("job_date", startWindow)
    .lte("job_date", endWindow)
    .order("job_date", { ascending: false })
    .limit(40);

  return (candidates ?? []) as CandidateJob[];
}

export async function confirmRecording(recording_id: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireLeadership();
  if (!auth.ok) return { ok: false, error: auth.error };
  const supabase = db();
  const { error } = await supabase
    .from("salesask_recordings")
    .update({
      match_method: "manual_confirmed",
      match_confidence: 1.0,
      bound_at: new Date().toISOString(),
    })
    .eq("id", recording_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/salesask");
  return { ok: true };
}

export async function relinkRecording(input: {
  recording_id: string;
  hcp_job_id: string;
}): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireLeadership();
  if (!auth.ok) return { ok: false, error: auth.error };
  const supabase = db();

  // Look up customer_id from the chosen job
  const { data: job } = await supabase
    .from("job_360")
    .select("hcp_customer_id")
    .eq("hcp_job_id", input.hcp_job_id)
    .maybeSingle();
  if (!job) return { ok: false, error: "Job not found." };

  const { error } = await supabase
    .from("salesask_recordings")
    .update({
      hcp_job_id: input.hcp_job_id,
      hcp_customer_id: (job.hcp_customer_id as string | null) ?? null,
      match_method: "manual",
      match_confidence: 1.0,
      bound_at: new Date().toISOString(),
    })
    .eq("id", input.recording_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/salesask");
  if (input.hcp_job_id) revalidatePath(`/job/${input.hcp_job_id}`);
  return { ok: true };
}

export async function unbindRecording(input: {
  recording_id: string;
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireLeadership();
  if (!auth.ok) return { ok: false, error: auth.error };
  const supabase = db();
  const { error } = await supabase
    .from("salesask_recordings")
    .update({
      hcp_job_id: null,
      hcp_customer_id: null,
      match_method: "manual_unbound",
      match_confidence: 0,
      bound_at: null,
    })
    .eq("id", input.recording_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/salesask");
  return { ok: true };
}
