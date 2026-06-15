"use server";

// Server actions for the per-job WORKLIST (active job page, P1).
// Decisions locked 2026-06-12: TECH-EDITABLE (techs add/skip/reorder), GUIDANCE-not-
// gating (requires_photo/note prompt, never hard-block Finish), append-only event log
// per step. Mirrors app/job/[id]/trigger-actions.ts (getCurrentTech + canWrite, db(),
// idempotent insert, revalidatePath). Tech scope is enforced upstream by the job page.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type JobTaskStatus = "todo" | "doing" | "done" | "skipped";

export type JobTask = {
  id: string;
  hcp_job_id: string;
  project_key: string | null;
  title: string;
  detail: string | null;
  sort_order: number;
  status: JobTaskStatus;
  requires_photo: boolean;
  requires_note: boolean;
  source: string;
  skip_reason: string | null;
  completed_by: string | null;
  completed_at: string | null;
  assignee: string | null;
};

export type JobTaskResult = { ok: true; task_id: string } | { ok: false; error: string };

const COLS =
  "id, hcp_job_id, project_key, title, detail, sort_order, status, requires_photo, requires_note, source, skip_reason, completed_by, completed_at, assignee";

// Read a job's worklist (ordered). No write gate.
export async function getJobTasks(hcp_job_id: string): Promise<JobTask[]> {
  const supabase = db();
  const { data } = await supabase
    .from("job_tasks")
    .select(COLS)
    .eq("hcp_job_id", hcp_job_id)
    .is("voided_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as JobTask[];
}

// Append-only step transition log (mirrors job_lifecycle_events idempotency).
async function logTaskEvent(
  task_id: string,
  hcp_job_id: string,
  status: string,
  actor: string | null,
  context?: Record<string, unknown>,
): Promise<void> {
  const supabase = db();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  await supabase.from("job_task_events").insert({
    task_id,
    hcp_job_id,
    status,
    actor,
    idempotency_key: `task:${task_id}:${status}:${today}`,
    context: context ?? null,
  });
}

// Tech adds a step (tech-editable). source='tech'.
export async function addJobTask(input: {
  hcp_job_id: string;
  project_key?: string | null;
  title: string;
  detail?: string;
  requires_photo?: boolean;
  requires_note?: boolean;
}): Promise<JobTaskResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite) return { ok: false, error: "No write access." };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Step needs a title." };

  const supabase = db();
  const { data: maxRow } = await supabase
    .from("job_tasks")
    .select("sort_order")
    .eq("hcp_job_id", input.hcp_job_id)
    .is("voided_at", null)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow?.sort_order as number) ?? -1) + 1;
  const actor = me.tech?.tech_short_name ?? me.email;

  const { data, error } = await supabase
    .from("job_tasks")
    .insert({
      hcp_job_id: input.hcp_job_id,
      project_key: input.project_key ?? null,
      title,
      detail: input.detail ?? null,
      sort_order: nextOrder,
      requires_photo: input.requires_photo ?? false,
      requires_note: input.requires_note ?? false,
      source: "tech",
      created_by: actor,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert failed" };

  await logTaskEvent(data.id as string, input.hcp_job_id, "added", actor);
  revalidatePath(`/job/${input.hcp_job_id}`);
  return { ok: true, task_id: data.id as string };
}

// Advance/toggle a step's status. 'done' stamps completed_by/at; reverting clears it.
export async function setJobTaskStatus(input: {
  task_id: string;
  hcp_job_id: string;
  status: JobTaskStatus;
}): Promise<JobTaskResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite) return { ok: false, error: "No write access." };

  const supabase = db();
  const actor = me.tech?.tech_short_name ?? me.email;
  const patch: Record<string, unknown> = { status: input.status };
  if (input.status === "done") {
    patch.completed_by = actor;
    patch.completed_at = new Date().toISOString();
  } else {
    patch.completed_by = null;
    patch.completed_at = null;
    if (input.status !== "skipped") patch.skip_reason = null;
  }

  const { error } = await supabase.from("job_tasks").update(patch).eq("id", input.task_id);
  if (error) return { ok: false, error: error.message };

  await logTaskEvent(input.task_id, input.hcp_job_id, input.status, actor);
  revalidatePath(`/job/${input.hcp_job_id}`);
  return { ok: true, task_id: input.task_id };
}

// Skip a step with a captured reason (feeds the learning loop in P3).
export async function skipJobTask(input: {
  task_id: string;
  hcp_job_id: string;
  reason: string;
}): Promise<JobTaskResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite) return { ok: false, error: "No write access." };

  const supabase = db();
  const actor = me.tech?.tech_short_name ?? me.email;
  const { error } = await supabase
    .from("job_tasks")
    .update({
      status: "skipped",
      skip_reason: input.reason?.trim() || null,
      completed_by: actor,
      completed_at: new Date().toISOString(),
    })
    .eq("id", input.task_id);
  if (error) return { ok: false, error: error.message };

  await logTaskEvent(input.task_id, input.hcp_job_id, "skipped", actor, { reason: input.reason ?? null });
  revalidatePath(`/job/${input.hcp_job_id}`);
  return { ok: true, task_id: input.task_id };
}

// Tech edits a step's title/detail (tech-editable).
export async function editJobTask(input: {
  task_id: string;
  hcp_job_id: string;
  title: string;
  detail?: string;
}): Promise<JobTaskResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite) return { ok: false, error: "No write access." };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Step needs a title." };

  const supabase = db();
  const { error } = await supabase
    .from("job_tasks")
    .update({ title, detail: input.detail ?? null })
    .eq("id", input.task_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/job/${input.hcp_job_id}`);
  return { ok: true, task_id: input.task_id };
}

// Assign (or unassign) a task to a crew member — the "distribute tasks" capability
// (Danny+Cody 2026-06-15). Lead / manager / admin only. assignee = tech_short_name,
// or null to unassign. v1 is FYI (no accept/decline); the assignee column is truth.
export async function assignJobTask(input: {
  task_id: string;
  hcp_job_id: string;
  assignee: string | null;
}): Promise<JobTaskResult> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "Not signed in." };
  const canAssign = me.isAdmin || me.isManager || !!me.tech?.is_lead;
  if (!canAssign) return { ok: false, error: "Only the job lead (or office) can assign tasks." };

  const supabase = db();
  const actor = me.tech?.tech_short_name ?? me.email;
  const assignee = input.assignee?.trim() || null;
  const { error } = await supabase
    .from("job_tasks")
    .update({ assignee, assigned_by: actor, assigned_at: new Date().toISOString() })
    .eq("id", input.task_id);
  if (error) return { ok: false, error: error.message };

  await logTaskEvent(input.task_id, input.hcp_job_id, assignee ? "assigned" : "unassigned", actor, { assignee });
  revalidatePath(`/job/${input.hcp_job_id}`);
  return { ok: true, task_id: input.task_id };
}

type TemplateStep = {
  title?: string;
  detail?: string | null;
  requires_photo?: boolean;
  requires_note?: boolean;
};

// Seed a job's worklist from its work_type template (HYBRID source) IF empty.
// Safe to call repeatedly — no-op once any task exists for the job.
export async function seedJobTasksFromTemplate(input: {
  hcp_job_id: string;
  work_type: string;
  project_key?: string | null;
}): Promise<{ seeded: number }> {
  const supabase = db();
  const { data: existing } = await supabase
    .from("job_tasks")
    .select("id")
    .eq("hcp_job_id", input.hcp_job_id)
    .is("voided_at", null)
    .limit(1);
  if (existing && existing.length > 0) return { seeded: 0 };

  const { data: tmpl } = await supabase
    .from("job_task_templates")
    .select("steps")
    .eq("work_type", input.work_type)
    .eq("is_active", true)
    .maybeSingle();
  const steps = (Array.isArray(tmpl?.steps) ? tmpl!.steps : []) as TemplateStep[];
  if (steps.length === 0) return { seeded: 0 };

  const rows = steps.map((s, i) => ({
    hcp_job_id: input.hcp_job_id,
    project_key: input.project_key ?? null,
    title: String(s.title ?? `Step ${i + 1}`),
    detail: s.detail ?? null,
    sort_order: i,
    requires_photo: !!s.requires_photo,
    requires_note: !!s.requires_note,
    source: "template",
    created_by: "system-template",
  }));
  const { error } = await supabase.from("job_tasks").insert(rows);
  if (error) return { seeded: 0 };
  revalidatePath(`/job/${input.hcp_job_id}`);
  return { seeded: rows.length };
}
