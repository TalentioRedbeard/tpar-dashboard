"use server";

// OMW-without-Finish guard (2026-06-01, Danny's spec).
// When a tech presses "On My Way" for their next job, check whether they left a
// PRIOR job open (started but never Finished). If so, the UI prompts: did you
// mean to Finish it, or is it Paused / something Other? Pause + Other keep the
// old job open/resumable but acknowledge it (job_pause_log) so we don't re-nag.
// Finish goes through the normal lifecycle trigger-6 path.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

// A job is "in progress" if the tech's most recent lifecycle event on it is one
// of these (i.e. not Finish(6) / Collect-Done(7)).
const IN_PROGRESS_TRIGGERS = new Set([2, 3, 4, 5]);
const LOOKBACK_MS = 48 * 60 * 60 * 1000;

export type OpenJob = {
  hcp_job_id: string;
  hcp_customer_id: string | null;
  appointment_id: string | null;
  customer_name: string | null;
  last_trigger: number;
  last_action_label: string;
  last_at: string;
};

const TRIGGER_LABEL: Record<number, string> = {
  2: "On My Way", 3: "Started", 4: "Estimate", 5: "Presented",
};

// Returns the tech's currently-open job (most recent), excluding the job they're
// about to OMW. Null if nothing is left hanging. Used to decide whether to show
// the guard modal before firing On-My-Way.
export async function getOpenJobForTech(excludeJobId: string): Promise<OpenJob | null> {
  const me = await getCurrentTech();
  if (!me?.tech) return null;
  const tech = me.tech.tech_short_name;
  const supa = db();
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

  const { data: events } = await supa
    .from("job_lifecycle_events")
    .select("hcp_job_id, hcp_customer_id, appointment_id, trigger_number, fired_at")
    .eq("fired_by", tech)
    .gte("fired_at", since)
    .order("fired_at", { ascending: true });
  if (!events || events.length === 0) return null;

  // Reduce to the latest event per job.
  type Latest = { customer_id: string | null; appointment_id: string | null; trigger: number; at: string };
  const byJob = new Map<string, Latest>();
  for (const e of events as Array<Record<string, unknown>>) {
    const jobId = e.hcp_job_id as string | null;
    if (!jobId || jobId === excludeJobId) continue;
    const at = e.fired_at as string;
    const cur = byJob.get(jobId);
    if (!cur || at > cur.at) {
      byJob.set(jobId, {
        customer_id: (e.hcp_customer_id as string | null) ?? null,
        appointment_id: (e.appointment_id as string | null) ?? null,
        trigger: e.trigger_number as number,
        at,
      });
    }
  }

  // Keep jobs whose latest event is still in-progress.
  const open = [...byJob.entries()].filter(([, v]) => IN_PROGRESS_TRIGGERS.has(v.trigger));
  if (open.length === 0) return null;

  // Drop jobs already acknowledged (a pause/other logged AFTER the job's latest
  // lifecycle event — so a later resume re-opens it).
  const jobIds = open.map(([id]) => id);
  const { data: pauses } = await supa
    .from("job_pause_log")
    .select("hcp_job_id, created_at")
    .eq("tech_short_name", tech)
    .in("hcp_job_id", jobIds);
  const ackedAt = new Map<string, string>();
  for (const p of (pauses ?? []) as Array<{ hcp_job_id: string; created_at: string }>) {
    const cur = ackedAt.get(p.hcp_job_id);
    if (!cur || p.created_at > cur) ackedAt.set(p.hcp_job_id, p.created_at);
  }
  const stillOpen = open.filter(([id, v]) => {
    const ack = ackedAt.get(id);
    return !ack || ack < v.at;
  });
  if (stillOpen.length === 0) return null;

  // Most-recently-touched open job.
  stillOpen.sort((a, b) => (a[1].at > b[1].at ? -1 : 1));
  const [jobId, v] = stillOpen[0];

  const { data: appt } = await supa
    .from("appointments_master")
    .select("customer_name")
    .eq("hcp_job_id", jobId)
    .limit(1)
    .maybeSingle();

  return {
    hcp_job_id: jobId,
    hcp_customer_id: v.customer_id,
    appointment_id: v.appointment_id,
    customer_name: (appt?.customer_name as string | null) ?? null,
    last_trigger: v.trigger,
    last_action_label: TRIGGER_LABEL[v.trigger] ?? `trigger ${v.trigger}`,
    last_at: v.at,
  };
}

// Acknowledge an open job as Paused or Other (keeps it open/resumable). Records
// who/when/why so the guard doesn't re-prompt for it.
export async function pauseOpenJob(input: {
  hcp_job_id: string;
  hcp_customer_id?: string | null;
  kind: "pause" | "other";
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech();
  if (!me?.tech) return { ok: false, error: "Not signed in as a tech." };
  if (!input.hcp_job_id) return { ok: false, error: "missing job" };
  const { error } = await db().from("job_pause_log").insert({
    hcp_job_id: input.hcp_job_id,
    hcp_customer_id: input.hcp_customer_id ?? null,
    tech_short_name: me.tech.tech_short_name,
    kind: input.kind,
    note: input.note?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
