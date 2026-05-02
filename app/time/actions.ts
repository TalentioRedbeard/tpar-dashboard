"use server";

// Server actions for tech clock-in / clock-out.
//
// TPAR is the source of truth for hours; HCP becomes the downstream mirror
// (mirror logic is queued, not yet wired). Every event is one row in
// public.tech_time_entries; edits go through admin endpoints (later).
//
// Schema fingerprint: see @tpar-forge/schemas/src/time-entries.ts (canonical).
// This file mirrors the input shapes inline — keep in sync until consolidation.

import { db } from "@/lib/supabase";
import { requireWriter } from "@/lib/current-tech";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

type Location = { lat: number; lng: number; accuracy_m?: number };

export type CurrentClockState =
  | { state: "clocked-out"; last_clock_out_at: string | null; last_entry_id: string | null }
  | {
      state: "clocked-in";
      clocked_in_at: string;
      entry_id: string;
      hcp_appointment_id: string | null;
      hcp_job_id: string | null;
      duration_seconds: number;
    };

export type ClockResult =
  | { ok: true; state: CurrentClockState; entry_id: string }
  | { ok: false; error: string };

/**
 * Resolve the current user → tech_id and short_name + slack_user_id.
 * If the user isn't a tech (admin without a tech row, or office staff),
 * we refuse the action.
 */
async function resolveTechIdentity(): Promise<
  | { ok: true; tech_id: string; tech_short_name: string; tech_slack_user_id: string | null; email: string }
  | { ok: false; error: string }
> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };

  const me = await getCurrentTech();
  if (!me?.tech) {
    return {
      ok: false,
      error: "Your account is signed in but isn't linked to a tech. Ask Danny to link your email in tech_directory.",
    };
  }
  return {
    ok: true,
    tech_id: me.tech.tech_id,
    tech_short_name: me.tech.tech_short_name,
    tech_slack_user_id: me.tech.slack_user_id,
    email: me.email,
  };
}

/**
 * Look at the most recent non-voided event for this tech.
 * If it's a clock-in, they're clocked in. Otherwise they're clocked out.
 */
export async function getCurrentState(): Promise<CurrentClockState> {
  const me = await getCurrentTech();
  if (!me?.tech) {
    return { state: "clocked-out", last_clock_out_at: null, last_entry_id: null };
  }
  const supabase = db();
  const { data, error } = await supabase
    .from("tech_time_entries")
    .select("id, kind, ts, hcp_appointment_id, hcp_job_id")
    .eq("tech_id", me.tech.tech_id)
    .is("voided_at", null)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return { state: "clocked-out", last_clock_out_at: null, last_entry_id: null };
  }

  if (data.kind === "in") {
    const tsMs = new Date(data.ts as string).getTime();
    const durationSec = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
    return {
      state: "clocked-in",
      clocked_in_at: data.ts as string,
      entry_id: data.id as string,
      hcp_appointment_id: (data.hcp_appointment_id as string | null) ?? null,
      hcp_job_id: (data.hcp_job_id as string | null) ?? null,
      duration_seconds: durationSec,
    };
  }
  return {
    state: "clocked-out",
    last_clock_out_at: data.ts as string,
    last_entry_id: data.id as string,
  };
}

export async function clockIn(input: {
  hcp_appointment_id?: string;
  hcp_job_id?: string;
  location?: Location;
  notes?: string;
  client_reported_at?: string;
}): Promise<ClockResult> {
  const me = await resolveTechIdentity();
  if (!me.ok) return { ok: false, error: me.error };

  const current = await getCurrentState();
  if (current.state === "clocked-in") {
    return {
      ok: false,
      error: `Already clocked in (since ${current.clocked_in_at}). Clock out before clocking in again.`,
    };
  }

  const supabase = db();
  const { data, error } = await supabase
    .from("tech_time_entries")
    .insert({
      tech_id: me.tech_id,
      tech_slack_user_id: me.tech_slack_user_id,
      tech_short_name: me.tech_short_name,
      kind: "in",
      ts: new Date().toISOString(),
      client_reported_at: input.client_reported_at ?? null,
      location: input.location ?? null,
      hcp_job_id: input.hcp_job_id ?? null,
      hcp_appointment_id: input.hcp_appointment_id ?? null,
      notes: input.notes ?? null,
      source: "tech-web",
      created_by: me.email,
    })
    .select("id, ts, hcp_appointment_id, hcp_job_id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "insert failed" };
  }

  revalidatePath("/");
  revalidatePath("/time");

  return {
    ok: true,
    entry_id: data.id as string,
    state: {
      state: "clocked-in",
      clocked_in_at: data.ts as string,
      entry_id: data.id as string,
      hcp_appointment_id: (data.hcp_appointment_id as string | null) ?? null,
      hcp_job_id: (data.hcp_job_id as string | null) ?? null,
      duration_seconds: 0,
    },
  };
}

export async function clockOut(input: {
  location?: Location;
  notes?: string;
  client_reported_at?: string;
}): Promise<ClockResult> {
  const me = await resolveTechIdentity();
  if (!me.ok) return { ok: false, error: me.error };

  const current = await getCurrentState();
  if (current.state !== "clocked-in") {
    return {
      ok: false,
      error: "You're not currently clocked in.",
    };
  }

  const supabase = db();
  const { data, error } = await supabase
    .from("tech_time_entries")
    .insert({
      tech_id: me.tech_id,
      tech_slack_user_id: me.tech_slack_user_id,
      tech_short_name: me.tech_short_name,
      kind: "out",
      ts: new Date().toISOString(),
      client_reported_at: input.client_reported_at ?? null,
      location: input.location ?? null,
      hcp_job_id: current.hcp_job_id,           // carry-over from the clock-in
      hcp_appointment_id: current.hcp_appointment_id,
      notes: input.notes ?? null,
      source: "tech-web",
      created_by: me.email,
    })
    .select("id, ts")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "insert failed" };
  }

  revalidatePath("/");
  revalidatePath("/time");

  return {
    ok: true,
    entry_id: data.id as string,
    state: {
      state: "clocked-out",
      last_clock_out_at: data.ts as string,
      last_entry_id: data.id as string,
    },
  };
}
