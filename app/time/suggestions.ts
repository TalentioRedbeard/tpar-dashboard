"use server";

// Server actions for clock-in suggestions (geofence-driven prompts).

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { clockIn } from "./actions";
import { revalidatePath } from "next/cache";

export type Suggestion = {
  id: string;
  tech_id: string;
  hcp_appointment_id: string;
  hcp_job_id: string | null;
  customer_name: string | null;
  scheduled_start: string | null;
  match_distance_meters: number | null;
  match_minutes_off_schedule: number | null;
  expires_at: string;
  created_at: string;
};

export type AcceptResult =
  | { ok: true; entry_id: string }
  | { ok: false; error: string };

export type DismissResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Get pending suggestions for the signed-in tech.
 * Admins / managers see all; tech sees only own.
 */
export async function getPendingSuggestions(): Promise<Suggestion[]> {
  const me = await getCurrentTech();
  if (!me) return [];
  const supa = db();
  let q = supa
    .from("pending_clock_in_suggestions_v")
    .select("id, tech_id, hcp_appointment_id, hcp_job_id, customer_name, scheduled_start, match_distance_meters, match_minutes_off_schedule, expires_at, created_at")
    .order("created_at", { ascending: false });
  if (!me.isAdmin && !me.isManager) {
    if (!me.tech?.tech_id) return [];
    q = q.eq("tech_id", me.tech.tech_id);
  }
  const { data } = await q;
  return (data ?? []) as Suggestion[];
}

export async function acceptSuggestion(suggestionId: string): Promise<AcceptResult> {
  const me = await getCurrentTech();
  if (!me?.tech) return { ok: false, error: "Only techs can accept their own suggestions." };

  const supa = db();
  const { data: sug } = await supa
    .from("clock_in_suggestions")
    .select("id, tech_id, hcp_appointment_id, hcp_job_id, status, expires_at")
    .eq("id", suggestionId)
    .maybeSingle();
  if (!sug) return { ok: false, error: "Suggestion not found." };
  if (sug.status !== "pending") return { ok: false, error: `Already ${sug.status}.` };
  if (sug.tech_id !== me.tech.tech_id && !me.isAdmin) {
    return { ok: false, error: "That suggestion isn't for you." };
  }
  if (new Date(sug.expires_at as string).getTime() < Date.now()) {
    return { ok: false, error: "Suggestion expired. Use the main Clock in button." };
  }

  // Clock in via the existing action
  const apptId = sug.hcp_appointment_id as string;
  const jobId = (sug.hcp_job_id as string | null) ?? undefined;
  const result = await clockIn({
    hcp_appointment_id: apptId,
    ...(jobId ? { hcp_job_id: jobId } : {}),
    client_reported_at: new Date().toISOString(),
  });

  if (!result.ok) return { ok: false, error: result.error };

  // Mark suggestion accepted
  await supa
    .from("clock_in_suggestions")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      accepted_entry_id: result.entry_id,
    })
    .eq("id", suggestionId);

  revalidatePath("/");
  revalidatePath("/me");
  revalidatePath("/time");
  return { ok: true, entry_id: result.entry_id };
}

export async function dismissSuggestion(suggestionId: string, reason?: string): Promise<DismissResult> {
  const me = await getCurrentTech();
  if (!me?.tech && !me?.isAdmin) return { ok: false, error: "Sign-in required." };

  const supa = db();
  const { data: sug } = await supa
    .from("clock_in_suggestions")
    .select("id, tech_id, status")
    .eq("id", suggestionId)
    .maybeSingle();
  if (!sug) return { ok: false, error: "Suggestion not found." };
  if (sug.status !== "pending") return { ok: false, error: `Already ${sug.status}.` };
  if (sug.tech_id !== me.tech?.tech_id && !me.isAdmin) {
    return { ok: false, error: "That suggestion isn't for you." };
  }

  const { error } = await supa
    .from("clock_in_suggestions")
    .update({
      status: "dismissed",
      dismissed_at: new Date().toISOString(),
      dismissed_reason: reason ?? `dismissed by ${me.email}`,
    })
    .eq("id", suggestionId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  revalidatePath("/me");
  return { ok: true };
}
