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

// HCP mirror — TPAR is source of truth for hours; HCP becomes a downstream
// mirror because HCP's REST has no time-tracking writes. Fire-and-forget.
// Design 2026-05-14 (post-DOM-probe): the mirror records a COMPLETE entry
// (start + end), so it only fires on clock-OUT. Clock-in is a TPAR-only
// event until the matching clock-out arrives.
async function fireHcpClockMirror(payload: {
  tech_short_name: string;
  hcp_employee_id: string | null;
  start_at: string;
  end_at: string;
  tech_time_entry_id: string;
  compensation_type?: string;
}): Promise<void> {
  if (!payload.hcp_employee_id) return; // No HCP employee → nothing to mirror to.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return;
  try {
    await fetch(`${supabaseUrl}/functions/v1/hcp-clock-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify(payload),
    });
  } catch {
    // Mirror failures must never block the user — bot can be down, retries are fine.
  }
}

// An open shift older than this is treated as STALE — the tech forgot to clock
// out (a legit long day is <=~14h). On the next clock-in we auto-void the stale
// 'in' row instead of dead-ending them. Keep this as a single source of truth.
const STALE_OPEN_HOURS = 16;
const STALE_OPEN_SECONDS = STALE_OPEN_HOURS * 3600; // 57600

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

// Parallel-clocks reconcile: keep the /me button honest against HCP by delegating
// to the canonical clock-reconcile-sweep edge fn -- the single both-directions
// reconcile, also run by the 30-min cron. Non-blocking + advisory: the page
// already rendered TPAR state; this runs on mount and the client router.refresh()es
// if anything changed (an HCP-native clock-in back-filled, or an HCP-native
// clock-out closing a stale-open shift). Service-role bearer.
export async function syncHcpClockStatus(): Promise<{ changed: boolean; reason?: string }> {
  const me = await getCurrentTech();
  const empId = me?.tech?.hcp_employee_id ?? null;
  if (!me?.tech || !empId) return { changed: false };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { changed: false };

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/clock-reconcile-sweep`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({ hcp_employee_id: empId, max_age_seconds: 90 }),
    });
    const data = await res.json();
    if (data?.changed) {
      revalidatePath("/");
      revalidatePath("/me");
      revalidatePath("/time");
      return { changed: true, reason: data.detail ? `${data.action}: ${data.detail}` : data.action };
    }
    return { changed: false };
  } catch {
    return { changed: false }; // never block the button on an HCP read
  }
}

/**
 * Convenience wrapper: clock in for a specific scheduled appointment.
 * Used by the /me per-appointment "Start" buttons.
 */
export async function clockInForAppointment(input: {
  hcp_appointment_id: string;
  hcp_job_id?: string;
  location?: Location;
  notes?: string;
}): Promise<ClockResult> {
  return clockIn({
    hcp_appointment_id: input.hcp_appointment_id,
    hcp_job_id: input.hcp_job_id,
    location: input.location,
    notes: input.notes,
    client_reported_at: new Date().toISOString(),
  });
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

  const supabase = db();

  const current = await getCurrentState();
  if (current.state === "clocked-in") {
    // Stale open shift = they forgot to clock out (ran past 16h). The TPAR clock
    // is NOT payroll-of-record (HCP native clock is), so the safe correction is
    // to void the runaway 'in' row — never fabricate a clock-out time/hours —
    // and let this new clock-in proceed. A recent open (<16h) is a real same-day
    // shift, so keep hard-rejecting to prevent an accidental double-clock-in.
    if (current.duration_seconds >= STALE_OPEN_SECONDS) {
      await supabase
        .from("tech_time_entries")
        .update({
          voided_at: new Date().toISOString(),
          voided_by: "system-autoclose",
          void_reason:
            "auto-closed: stale open shift (>16h) superseded by new clock-in; TPAR clock not payroll-of-record",
        })
        .eq("id", current.entry_id);
      // Fall through to the fresh clock-in below. No HCP mirror — the mirror only
      // fires on a real clock-OUT insert, and a voided row has no hours to write.
    } else {
      const since = new Date(current.clocked_in_at).toLocaleTimeString("en-US", {
        timeZone: "America/Chicago",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      return {
        ok: false,
        error: `Already clocked in since ${since}. Clock out first.`,
      };
    }
  }

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
  revalidatePath("/me");
  revalidatePath("/time");

  // Clock-in is TPAR-only — the HCP mirror waits for the matching clock-out
  // so it can write a complete time-entry record in one shot.

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
  revalidatePath("/me");
  revalidatePath("/time");

  // Fire HCP mirror with the COMPLETE pair (start=current.clocked_in_at, end=this clock-out).
  // Single atomic time entry — no half-state to babysit. Fire-and-forget; user isn't blocked.
  void fireHcpClockMirror({
    tech_short_name: me.tech_short_name,
    hcp_employee_id: (await getCurrentTech())?.tech?.hcp_employee_id ?? null,
    start_at: current.clocked_in_at,
    end_at: data.ts as string,
    tech_time_entry_id: data.id as string,
    compensation_type: "Regular",
  });

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
