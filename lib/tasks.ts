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

export type TaskRequirement = { text: string; kind: "requirement" | "skill"; added_by?: string; added_at?: string };
export type Task = {
  id: string;
  title: string;
  detail: string | null;
  assigned_to: string | null;
  status: "open" | "in_progress" | "done";
  requirements: TaskRequirement[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
};
export type TaskResult = { ok: true } | { ok: false; error: string };

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

export async function setTaskStatus(id: string, status: "open" | "in_progress" | "done"): Promise<TaskResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const now = new Date().toISOString();
  const { error } = await db().from("tasks").update({ status, updated_at: now, done_at: status === "done" ? now : null }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dispatch");
  return { ok: true };
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

export type DannyNote = { id: string; author_short_name: string | null; body: string; created_at: string; read_at: string | null };

export async function listNotesToDanny(limit = 30): Promise<DannyNote[]> {
  const me = await getCurrentTech();
  if (!me || !isOwner(me.realEmail)) return [];
  const { data } = await db()
    .from("team_notes")
    .select("id, author_short_name, body, created_at, read_at")
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
