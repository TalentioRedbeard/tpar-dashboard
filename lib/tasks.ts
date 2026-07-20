"use server";

// Dispatch Task List + "Note to Danny" (Danny 2026-05-31).
// Tasks are assignable and accumulate requirements + needed skillsets. When a
// requirement/skillset gap needs Danny, sendNoteToDanny() drops a note into
// team_notes (→ owner) and Slack-pings him — reusing the existing notes plumbing.
// The owner-only receiving window lives on AdminHome.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { isOwner, ownerEmail } from "@/lib/admin";
import { revalidatePath } from "next/cache";
import { BLOCKER_TYPES, TASK_CATEGORIES, type BlockerType, type Task, type TaskRequirement, type TaskResult, type TaskStatus, type TaskTemplate, type TaskTemplateInput } from "@/lib/task-types";

// NOTE: lib/tasks.ts is "use server" — it may export ONLY async server actions, not
// types or constants (the RSC compiler treats every export as an action reference).
// All shared types + pure helpers (BLOCKER_TYPES, isBlockerReq, Task, …) live in and
// are imported from lib/task-types.ts. Do NOT re-export them here.

async function gate(): Promise<{ email: string; name: string } | { error: string }> {
  const me = await getCurrentTech();
  if (!me) return { error: "not signed in" };
  if (!(me.isAdmin || me.isManager || me.tech?.is_lead)) return { error: "dispatch role required (admin/manager/lead)" };
  return { email: me.email, name: me.tech?.tech_short_name ?? me.email.split("@")[0] };
}

export async function listTasks(): Promise<Task[]> {
  const me = await getCurrentTech();
  if (!me) return [];
  const { data } = await db()
    .from("tasks")
    .select("*")
    .order("status", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []) as Task[];
}

// Tech-facing: tasks assigned to the signed-in tech, not yet done (#18).
export async function listMyTasks(): Promise<Task[]> {
  const me = await getCurrentTech();
  if (!me?.tech) return [];
  const { data } = await db()
    .from("tasks")
    .select("*")
    .eq("assigned_to", me.tech.tech_short_name)
    .not("status", "in", "(done,canceled)")
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as Task[];
}

// Tech accept / "can't do" on an assigned task (#18). Declining with a reason
// records the gap on the task (as a skill requirement) AND flags Danny — the
// bridge to the structured skillset layer. Tech-allowed (bypasses the
// admin/manager gate, since this IS the tech responding).
export async function respondToTask(taskId: string, response: "accepted" | "declined", note?: string): Promise<TaskResult> {
  const me = await getCurrentTech();
  if (!me?.tech) return { ok: false, error: "not signed in" };
  const myName = me.tech.tech_short_name;
  const supa = db();
  const { data: task } = await supa.from("tasks").select("title, assigned_to, requirements").eq("id", taskId).maybeSingle();
  if (!task) return { ok: false, error: "task not found" };
  if (task.assigned_to && task.assigned_to !== myName && !me.isAdmin) return { ok: false, error: "this task isn't assigned to you" };

  const now = new Date().toISOString();
  const noteClean = (note ?? "").trim().slice(0, 500) || null;
  const patch: Record<string, unknown> = { tech_response: response, tech_response_note: noteClean, tech_response_at: now, updated_at: now };
  if (response === "accepted") patch.status = "in_progress";
  if (response === "declined" && noteClean) {
    const reqs = (Array.isArray(task.requirements) ? task.requirements : []) as TaskRequirement[];
    reqs.push({ text: noteClean, kind: "skill", added_by: myName, added_at: now } as TaskRequirement);
    patch.requirements = reqs;
  }
  const { error } = await supa.from("tasks").update(patch).eq("id", taskId);
  if (error) return { ok: false, error: error.message };

  if (response === "declined") {
    try {
      await supa.from("team_notes").insert({
        author_email: me.email,
        author_short_name: myName,
        target_kind: "teammate",
        target_email: ownerEmail(),
        target_short_name: "Danny",
        body: `🚧 ${myName} can't do task "${task.title}"${noteClean ? `: ${noteClean}` : ""} — missing skill/requirement to fill.`,
        attach_kind: null,
        attach_ref: taskId,
        tags: ["note-to-danny", "task-decline", "skill-gap"],
        urgent: false,
      });
      const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      await fetch(`${SUPABASE_URL}/functions/v1/notify-danny`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Trigger-Secret": process.env.NOTIFY_DANNY_SECRET ?? "" },
        body: JSON.stringify({ text: `🚧 *${myName} can't do a task*: "${task.title}"${noteClean ? `\n> ${noteClean}` : ""}`, context: "task-decline" }),
      });
    } catch { /* best-effort */ }
  }
  revalidatePath("/");
  revalidatePath("/dispatch");
  return { ok: true };
}

export async function createTask(input: { title: string; detail?: string; assigned_to?: string }): Promise<TaskResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Title required." };
  const { error } = await db().from("tasks").insert({
    title: title.slice(0, 300),
    detail: (input.detail ?? "").trim().slice(0, 4000) || null,
    assigned_to: (input.assigned_to ?? "").trim() || null,
    created_by: g.name,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dispatch");
  return { ok: true };
}

export async function setTaskStatus(id: string, status: TaskStatus): Promise<TaskResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const supa = db();
  const now = new Date().toISOString();
  // Load parent linkage so we can auto-unblock the parent when its children resolve.
  const { data: task } = await supa
    .from("tasks")
    .select("id, parent_task_id, source, ref_kind")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supa.from("tasks").update({ status, updated_at: now, done_at: status === "done" ? now : null }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  await logTaskEvent(id, status === "done" ? "done" : status === "canceled" ? "canceled" : "status", g.name, { status });

  // Feedback loop shipped hook (spec §3d, Danny decision #2 = in): finishing a
  // feedback-born task flips every rider item to 'shipped' and re-notifies the
  // tech — the payoff moment IS the deliverable. Best-effort; task write stands.
  if (status === "done" && task?.ref_kind === "feedback_item") {
    try {
      const { data: items } = await supa
        .from("feedback_items")
        .select("id, tech, wrap_date, summary, response_note")
        .eq("task_id", id)
        .eq("status", "implementing");
      const shipDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      for (const it of (items ?? []) as Array<{ id: string; tech: string; wrap_date: string; summary: string; response_note: string | null }>) {
        await supa.from("feedback_items").update({
          status: "shipped",
          response_note: `${it.response_note ?? ""} — Shipped ${shipDate}`.trim(),
        }).eq("id", it.id).eq("status", "implementing");
        const { notifyTechFeedback } = await import("./notify-tech");
        await notifyTechFeedback({
          itemId: it.id, tech: it.tech, wrapDate: it.wrap_date, summary: it.summary,
          responseNote: `This one's DONE — shipped ${shipDate}. ${it.response_note ?? ""}`.trim(),
          respondedBy: g.name,
        });
      }
      revalidatePath("/me");
      revalidatePath("/manage/feedback");
    } catch {
      // guide surface — never block the task write
    }
  }

  // Auto-unblock the parent: when a child resolves (done/canceled) and ALL siblings are
  // resolved, the blocked parent returns to in_progress, clears blocked_reason, and notifies
  // its assignee (Task System v1, the headline mechanic).
  if (task?.parent_task_id && (status === "done" || status === "canceled")) {
    await maybeUnblockParent(task.parent_task_id, g.name);
  }
  revalidatePath("/dispatch");
  revalidatePath("/");
  return { ok: true };
}

// ── Task System v1 — append-only event log (task_events) ──────────────────
// Best-effort: the table is added by the backend agent concurrently. Until the
// migration lands these writes silently no-op (caught) so the UI never breaks.
async function logTaskEvent(taskId: string, event: string, actor: string, detail?: Record<string, unknown>): Promise<void> {
  try {
    await db().from("task_events").insert({ task_id: taskId, event, actor, detail: detail ?? {} });
  } catch { /* table not yet migrated — best-effort */ }
}

// Re-check a parent's children; if every child is done/canceled and the parent is still
// blocked, flip it back to in_progress, clear its blocked_reason, log + notify the assignee.
async function maybeUnblockParent(parentId: string, actor: string): Promise<void> {
  const supa = db();
  const { data: parent } = await supa
    .from("tasks")
    .select("id, title, status, assigned_to, blocked_reason")
    .eq("id", parentId)
    .maybeSingle();
  if (!parent || parent.status !== "blocked") return;
  const { data: children } = await supa.from("tasks").select("status").eq("parent_task_id", parentId);
  const kids = children ?? [];
  if (kids.length === 0) return;
  const allResolved = kids.every((c) => c.status === "done" || c.status === "canceled");
  if (!allResolved) return;
  const now = new Date().toISOString();
  await supa.from("tasks").update({ status: "in_progress", blocked_reason: null, updated_at: now }).eq("id", parentId);
  await logTaskEvent(parentId, "unblocked", actor, { reason: "all requirement tasks resolved" });
  // Notify the parent's assignee in-app via team_notes (the reliable tech channel).
  if (parent.assigned_to) {
    try {
      await supa.from("team_notes").insert({
        author_email: ownerEmail(),
        author_short_name: "TPAR",
        target_kind: "teammate",
        target_email: null,
        target_short_name: parent.assigned_to,
        body: `✅ You're unblocked: "${parent.title}" — the requirement(s) you were waiting on are resolved. Pick it back up.`,
        attach_kind: null,
        attach_ref: parentId,
        tags: ["task-unblocked"],
        urgent: false,
      });
    } catch { /* best-effort */ }
  }
}

// ── markBlocked — tech (or manager) flags a wall on an assigned task ───────
// Sets status='blocked', records blocked_reason + a structured blocker requirement,
// logs the event, and fires the EXISTING "Note to Danny" + Slack escalation.
// MANUAL per Danny Q3: this does NOT auto-spawn a child — a manager spawns the
// requirement task from /dispatch.
export async function markBlocked(taskId: string, types: BlockerType[], note?: string): Promise<TaskResult> {
  const me = await getCurrentTech();
  if (!me?.tech && !me?.isAdmin && !me?.isManager) return { ok: false, error: "not signed in" };
  const myName = me?.tech?.tech_short_name ?? me?.email?.split("@")[0] ?? "tech";
  const supa = db();
  const cleanTypes = types.filter((t): t is BlockerType => BLOCKER_TYPES.some((b) => b.value === t));
  if (cleanTypes.length === 0) return { ok: false, error: "Pick at least one blocker type." };
  const { data: task } = await supa.from("tasks").select("title, assigned_to, requirements").eq("id", taskId).maybeSingle();
  if (!task) return { ok: false, error: "task not found" };
  // The assigned tech responds; admins/managers may also block on a tech's behalf.
  if (task.assigned_to && task.assigned_to !== myName && !me?.isAdmin && !me?.isManager) {
    return { ok: false, error: "this task isn't assigned to you" };
  }

  const now = new Date().toISOString();
  const noteClean = (note ?? "").trim().slice(0, 500) || null;
  const reqs = (Array.isArray(task.requirements) ? task.requirements : []) as TaskRequirement[];
  reqs.push({ kind: "blocker", types: cleanTypes, note: noteClean, added_by: myName, added_at: now } as TaskRequirement);
  const { error } = await supa
    .from("tasks")
    .update({ status: "blocked", blocked_reason: noteClean, requirements: reqs, updated_at: now })
    .eq("id", taskId);
  if (error) return { ok: false, error: error.message };
  await logTaskEvent(taskId, "blocked", myName, { types: cleanTypes, note: noteClean });

  // Fire the existing "Note to Danny" + Slack escalation (reuse the decline plumbing).
  const typeLabels = cleanTypes.map((t) => BLOCKER_TYPES.find((b) => b.value === t)?.label ?? t).join(", ");
  try {
    await supa.from("team_notes").insert({
      author_email: me?.email ?? ownerEmail(),
      author_short_name: myName,
      target_kind: "teammate",
      target_email: ownerEmail(),
      target_short_name: "Danny",
      body: `🚧 ${myName} is blocked on "${task.title}" — needs: ${typeLabels}${noteClean ? `. ${noteClean}` : ""}`,
      attach_kind: null,
      attach_ref: taskId,
      tags: ["note-to-danny", "task-blocked"],
      urgent: false,
    });
    const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    await fetch(`${SUPABASE_URL}/functions/v1/notify-danny`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Trigger-Secret": process.env.NOTIFY_DANNY_SECRET ?? "" },
      body: JSON.stringify({ text: `🚧 *${myName} is blocked*: "${task.title}" — needs ${typeLabels}${noteClean ? `\n> ${noteClean}` : ""}`, context: "task-blocked" }),
    });
  } catch { /* best-effort */ }
  revalidatePath("/");
  revalidatePath("/dispatch");
  return { ok: true };
}

// ── spawnChildTask — manager creates a requirement task off a blocked parent ──
// Inserts a child tasks row (parent_task_id=parentId, source='job-block'), assigned
// to a person OR a role, and logs the parent's 'child_spawned' event.
export async function spawnChildTask(
  parentId: string,
  input: { title: string; detail?: string; assignedTo?: string; assignedRole?: string },
): Promise<TaskResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Requirement title required." };
  const supa = db();
  const { data: parent } = await supa.from("tasks").select("id, title").eq("id", parentId).maybeSingle();
  if (!parent) return { ok: false, error: "parent task not found" };
  const { data: child, error } = await supa
    .from("tasks")
    .insert({
      title: title.slice(0, 300),
      detail: (input.detail ?? "").trim().slice(0, 4000) || null,
      assigned_to: (input.assignedTo ?? "").trim() || null,
      assigned_role: (input.assignedRole ?? "").trim() || null,
      parent_task_id: parentId,
      source: "job-block",
      created_by: g.name,
    })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  await logTaskEvent(parentId, "child_spawned", g.name, { child_task_id: child?.id ?? null, title });
  if (child?.id) await logTaskEvent(child.id, "created", g.name, { source: "job-block", parent_task_id: parentId });
  revalidatePath("/dispatch");
  return { ok: true };
}

// ── Helpers — children of a task + the blocked-task list ───────────────────
export async function listChildren(parentId: string): Promise<Task[]> {
  const me = await getCurrentTech();
  if (!me) return [];
  const { data } = await db()
    .from("tasks")
    .select("*")
    .eq("parent_task_id", parentId)
    .order("created_at", { ascending: true });
  return (data ?? []) as Task[];
}

// Children of the signed-in tech's own blocked tasks, grouped by parent_task_id —
// powers the "Waiting on" panel in MyTasks. One query, grouped in JS.
export async function listMyTaskChildren(): Promise<Record<string, Task[]>> {
  const me = await getCurrentTech();
  if (!me?.tech) return {};
  const { data: parents } = await db()
    .from("tasks")
    .select("id")
    .eq("assigned_to", me.tech.tech_short_name)
    .eq("status", "blocked");
  const parentIds = (parents ?? []).map((p) => p.id as string);
  if (parentIds.length === 0) return {};
  const { data: kids } = await db()
    .from("tasks")
    .select("*")
    .in("parent_task_id", parentIds)
    .order("created_at", { ascending: true });
  const byParent: Record<string, Task[]> = {};
  for (const k of (kids ?? []) as Task[]) {
    const pid = k.parent_task_id as string;
    (byParent[pid] ??= []).push(k);
  }
  return byParent;
}

export async function listBlockedTasks(): Promise<Task[]> {
  const me = await getCurrentTech();
  if (!me) return [];
  const { data } = await db()
    .from("tasks")
    .select("*")
    .eq("status", "blocked")
    .order("updated_at", { ascending: false })
    .limit(100);
  return (data ?? []) as Task[];
}

export async function assignTask(id: string, assigned_to: string): Promise<TaskResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const { error } = await db().from("tasks").update({ assigned_to: assigned_to.trim() || null, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dispatch");
  return { ok: true };
}

export async function addRequirement(id: string, req: { text: string; kind: "requirement" | "skill" }): Promise<TaskResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const text = req.text.trim();
  if (!text) return { ok: false, error: "Requirement text required." };
  const { data: cur } = await db().from("tasks").select("requirements").eq("id", id).maybeSingle();
  const reqs = (Array.isArray(cur?.requirements) ? cur!.requirements : []) as TaskRequirement[];
  reqs.push({ text: text.slice(0, 300), kind: req.kind, added_by: g.name, added_at: new Date().toISOString() });
  const { error } = await db().from("tasks").update({ requirements: reqs, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dispatch");
  return { ok: true };
}

// ── Downtime bank (Task System v1, item b) ────────────────────────────────
// The tasks_master template bank (17 real templates: clean van, restock, study,
// photo audit, outreach route, …). Read-only list + an "Assign" action that drops
// a tasks row with template_key + source='downtime-bank' onto a tech or a role.
// TaskTemplate type lives in lib/task-types.ts (imported above).
export async function listTaskTemplates(): Promise<TaskTemplate[]> {
  const me = await getCurrentTech();
  if (!me) return [];
  const { data } = await db()
    .from("tasks_master")
    .select("id, task_key, task_name, category, instructions, expected_outcome, trackable_metric, estimated_minutes, eligible_techs, requires_geo, geo_target, min_gap_minutes, sort_order, active")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("task_name", { ascending: true });
  return (data ?? []) as TaskTemplate[];
}

// ── Downtime-bank management (Danny 2026-07-20): managers own the task library —
// create / edit / remove / reorder. Gate is admin|manager (not lead: the bank is a
// company-wide library, editable by management). db() is service-role → self-authorize.
async function gateManage(): Promise<{ name: string } | { error: string }> {
  const me = await getCurrentTech();
  if (!me) return { error: "not signed in" };
  if (!(me.isAdmin || me.isManager)) return { error: "manager or admin required" };
  return { name: me.tech?.tech_short_name ?? me.email.split("@")[0] };
}

function slugifyKey(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "task";
}
function cleanText(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s.slice(0, 4000) : null;
}
function cleanInt(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function cleanTechs(v: string[] | null | undefined): string[] | null {
  if (!v) return null;
  const arr = v.map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : null;
}

export async function createTaskTemplate(input: TaskTemplateInput): Promise<TaskResult> {
  const g = await gateManage();
  if ("error" in g) return { ok: false, error: g.error };
  const name = (input.task_name ?? "").trim();
  if (!name) return { ok: false, error: "Task name is required." };
  if (!TASK_CATEGORIES.includes(input.category)) return { ok: false, error: "Pick a valid category." };
  const instructions = (input.instructions ?? "").trim();
  if (!instructions) return { ok: false, error: "Instructions are required — say how to do the task so anyone can follow it." };
  const supa = db();
  // Unique task_key derived from the name (append _2, _3… on collision).
  const base = slugifyKey(name);
  let key = base;
  for (let i = 2; i < 50; i++) {
    const { data: hit } = await supa.from("tasks_master").select("id").eq("task_key", key).maybeSingle();
    if (!hit) break;
    key = `${base}_${i}`;
  }
  const { data: maxRow } = await supa.from("tasks_master").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const nextSort = ((maxRow?.sort_order as number | undefined) ?? 0) + 10;
  const { error } = await supa.from("tasks_master").insert({
    task_key: key,
    task_name: name.slice(0, 200),
    category: input.category,
    instructions: instructions.slice(0, 4000),
    expected_outcome: cleanText(input.expected_outcome),
    trackable_metric: cleanText(input.trackable_metric),
    estimated_minutes: cleanInt(input.estimated_minutes),
    eligible_techs: cleanTechs(input.eligible_techs),
    requires_geo: !!input.requires_geo,
    geo_target: cleanText(input.geo_target),
    sort_order: nextSort,
    active: true,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dispatch");
  return { ok: true };
}

export async function updateTaskTemplate(id: number, patch: TaskTemplateInput): Promise<TaskResult> {
  const g = await gateManage();
  if ("error" in g) return { ok: false, error: g.error };
  const name = (patch.task_name ?? "").trim();
  if (!name) return { ok: false, error: "Task name is required." };
  if (!TASK_CATEGORIES.includes(patch.category)) return { ok: false, error: "Pick a valid category." };
  const instructions = (patch.instructions ?? "").trim();
  if (!instructions) return { ok: false, error: "Instructions are required — say how to do the task so anyone can follow it." };
  const { error } = await db().from("tasks_master").update({
    task_name: name.slice(0, 200),
    category: patch.category,
    instructions: instructions.slice(0, 4000),
    expected_outcome: cleanText(patch.expected_outcome),
    trackable_metric: cleanText(patch.trackable_metric),
    estimated_minutes: cleanInt(patch.estimated_minutes),
    eligible_techs: cleanTechs(patch.eligible_techs),
    requires_geo: !!patch.requires_geo,
    geo_target: cleanText(patch.geo_target),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dispatch");
  return { ok: true };
}

export async function setTaskTemplateActive(id: number, active: boolean): Promise<TaskResult> {
  const g = await gateManage();
  if ("error" in g) return { ok: false, error: g.error };
  const { error } = await db().from("tasks_master").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dispatch");
  return { ok: true };
}

// Reorder = swap sort_order with the nearest active neighbor in the given direction.
export async function moveTaskTemplate(id: number, direction: "up" | "down"): Promise<TaskResult> {
  const g = await gateManage();
  if ("error" in g) return { ok: false, error: g.error };
  const supa = db();
  const { data: cur } = await supa.from("tasks_master").select("id, sort_order").eq("id", id).maybeSingle();
  if (!cur) return { ok: false, error: "task not found" };
  const curSort = cur.sort_order as number;
  const { data: neighbor } = direction === "up"
    ? await supa.from("tasks_master").select("id, sort_order").eq("active", true).lt("sort_order", curSort).order("sort_order", { ascending: false }).limit(1).maybeSingle()
    : await supa.from("tasks_master").select("id, sort_order").eq("active", true).gt("sort_order", curSort).order("sort_order", { ascending: true }).limit(1).maybeSingle();
  if (!neighbor) return { ok: true }; // already at the edge — no-op
  await supa.from("tasks_master").update({ sort_order: neighbor.sort_order as number }).eq("id", id);
  await supa.from("tasks_master").update({ sort_order: curSort }).eq("id", neighbor.id as number);
  revalidatePath("/dispatch");
  return { ok: true };
}

export async function assignFromTemplate(
  taskKey: string,
  target: { assignedTo?: string; assignedRole?: string },
): Promise<TaskResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const assignedTo = (target.assignedTo ?? "").trim() || null;
  const assignedRole = (target.assignedRole ?? "").trim() || null;
  if (!assignedTo && !assignedRole) return { ok: false, error: "Pick a tech or a role to assign to." };
  const supa = db();
  const { data: tmpl } = await supa
    .from("tasks_master")
    .select("task_key, task_name, instructions")
    .eq("task_key", taskKey)
    .eq("active", true)
    .maybeSingle();
  if (!tmpl) return { ok: false, error: "template not found" };
  const { data: row, error } = await supa
    .from("tasks")
    .insert({
      title: (tmpl.task_name as string).slice(0, 300),
      detail: (tmpl.instructions as string | null)?.slice(0, 4000) || null,
      assigned_to: assignedTo,
      assigned_role: assignedRole,
      template_key: tmpl.task_key as string,
      source: "downtime-bank",
      created_by: g.name,
    })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (row?.id) await logTaskEvent(row.id, "created", g.name, { source: "downtime-bank", template_key: taskKey, assigned_to: assignedTo, assigned_role: assignedRole });
  revalidatePath("/dispatch");
  return { ok: true };
}

// ── Note to Danny — reuses team_notes (→ owner) + the existing Slack ping ──
export async function sendNoteToDanny(body: string, opts?: { taskId?: string; taskTitle?: string }): Promise<TaskResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const text = body.trim();
  if (!text) return { ok: false, error: "Note can't be empty." };
  const fullBody = (opts?.taskTitle ? `[Task: ${opts.taskTitle}] ` : "") + text;
  const { error } = await db().from("team_notes").insert({
    author_email: g.email,
    author_short_name: g.name,
    target_kind: "teammate",
    target_email: ownerEmail(),
    target_short_name: "Danny",
    body: fullBody.slice(0, 5000),
    attach_kind: null,
    attach_ref: opts?.taskId ?? null,
    tags: ["note-to-danny"],
    urgent: false,
  });
  if (error) return { ok: false, error: error.message };
  // Best-effort Slack ping to Danny.
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const txt = `📋 *Note to Danny from ${g.name}*\n\n${fullBody.slice(0, 1200)}${fullBody.length > 1200 ? "…" : ""}\n\n<https://tpar-dashboard.vercel.app/|Open dashboard>`;
    await fetch(`${SUPABASE_URL}/functions/v1/notify-danny`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Trigger-Secret": process.env.NOTIFY_DANNY_SECRET ?? "" },
      body: JSON.stringify({ text: txt, context: "note-to-danny" }),
    });
  } catch { /* best-effort */ }
  revalidatePath("/dispatch");
  revalidatePath("/");
  return { ok: true };
}

export type DannyNote = { id: string; author_short_name: string | null; body: string; attach_ref: string | null; tags: string[] | null; created_at: string; read_at: string | null };

export async function listNotesToDanny(limit = 30): Promise<DannyNote[]> {
  const me = await getCurrentTech();
  if (!me || !isOwner(me.realEmail)) return [];
  const { data } = await db()
    .from("team_notes")
    .select("id, author_short_name, body, attach_ref, tags, created_at, read_at")
    .eq("target_email", ownerEmail())
    .contains("tags", ["note-to-danny"])
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as DannyNote[];
}

export async function markDannyNoteRead(id: string): Promise<TaskResult> {
  const me = await getCurrentTech();
  if (!me || !isOwner(me.realEmail)) return { ok: false, error: "owner only" };
  await db().from("team_notes").update({ read_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/");
  return { ok: true };
}
