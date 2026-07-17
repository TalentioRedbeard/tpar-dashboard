"use server";

// /manage/feedback verbs (spec §3c): Reply · Make a task · Can't do it, here's
// why. Every verb writes responded_* then fires the tech's Slack DM
// fire-and-forget via after() (the 2026-06-17 race class — never block or
// race the revalidate). Drafts come from the daily analyzer; a human ALWAYS
// approves/edits — nothing auto-sends (speech-filter law).

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/supabase";
import { requireManagement } from "@/lib/current-tech";
import { notifyTechFeedback } from "@/lib/notify-tech";

export type FeedbackVerbResult = { ok: true } | { ok: false; error: string };

type ItemRow = {
  id: string; tech: string; wrap_date: string; summary: string; status: string; cluster_key: string | null;
};

async function loadOpenItem(id: string): Promise<ItemRow | null> {
  const { data } = await db()
    .from("feedback_items")
    .select("id, tech, wrap_date, summary, status, cluster_key")
    .eq("id", id)
    .maybeSingle();
  const row = (data ?? null) as ItemRow | null;
  return row && row.status === "open" ? row : null;
}

function notifyAfter(items: ItemRow[], note: string, by: string) {
  after(async () => {
    for (const it of items) {
      await notifyTechFeedback({
        itemId: it.id, tech: it.tech, wrapDate: it.wrap_date,
        summary: it.summary, responseNote: note, respondedBy: by,
      });
    }
  });
}

/** Reply or explain — both need the human's words (an edited draft counts). */
export async function decideFeedbackItem(input: {
  id: string;
  decision: "reply" | "explain";
  note: string;
}): Promise<FeedbackVerbResult> {
  const gate = await requireManagement();
  if (!gate.ok) return { ok: false, error: gate.error };
  const note = input.note?.trim();
  if (!note) {
    return { ok: false, error: input.decision === "explain"
      ? "Say why it can't happen — the tech hears this back, and the why is the whole point."
      : "Write (or edit the draft into) the reply — it goes to the tech in your words." };
  }

  const item = await loadOpenItem(input.id);
  if (!item) return { ok: false, error: "Not an open feedback item (already answered?)." };

  const { error } = await db()
    .from("feedback_items")
    .update({
      status: input.decision === "reply" ? "replied" : "explained",
      response_kind: input.decision === "reply" ? "reply" : "explain",
      response_note: note.slice(0, 2000),
      responded_by: gate.email,
      responded_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("status", "open");
  if (error) return { ok: false, error: error.message };

  notifyAfter([item], note, gate.email);
  revalidatePath("/manage/feedback");
  revalidatePath("/me");
  return { ok: true };
}

/** Make a task — apply-to-cluster: ONE task, every checked item rides it. */
export async function implementFeedbackItems(input: {
  anchorId: string;
  alsoIds?: string[];
  note?: string;
  assignTo?: string; // tech_short_name; defaults to the actor's handle
}): Promise<FeedbackVerbResult> {
  const gate = await requireManagement();
  if (!gate.ok) return { ok: false, error: gate.error };

  const anchor = await loadOpenItem(input.anchorId);
  if (!anchor) return { ok: false, error: "Not an open feedback item (already answered?)." };
  const also: ItemRow[] = [];
  for (const id of [...new Set(input.alsoIds ?? [])].filter((x) => x !== input.anchorId)) {
    const row = await loadOpenItem(id);
    if (row) also.push(row);
  }
  const all = [anchor, ...also];
  const note = input.note?.trim() || "Making this happen — task created.";
  const supa = db();

  const { data: task, error: tErr } = await supa
    .from("tasks")
    .insert({
      title: `Feedback: ${anchor.summary.slice(0, 90)}`,
      detail: all.map((i) => `• [${i.tech} · ${i.wrap_date}] ${i.summary}`).join("\n"),
      assigned_to: input.assignTo?.trim() || gate.email.split("@")[0],
      status: "open",
      source: "feedback-loop",
      ref_kind: "feedback_item",
      ref_id: anchor.id,
      created_by: gate.email,
    })
    .select("id")
    .single();
  if (tErr || !task) {
    if ((tErr as { code?: string } | null)?.code === "23505") {
      return { ok: false, error: "A task already exists for this item (maybe canceled but still holding the slot) — work it from the task list instead of re-creating." };
    }
    return { ok: false, error: tErr?.message ?? "task insert failed" };
  }

  const { error: uErr } = await supa
    .from("feedback_items")
    .update({
      status: "implementing",
      task_id: task.id as string,
      response_kind: "implement",
      response_note: note.slice(0, 2000),
      responded_by: gate.email,
      responded_at: new Date().toISOString(),
    })
    .in("id", all.map((i) => i.id))
    .eq("status", "open");
  if (uErr) return { ok: false, error: uErr.message };

  notifyAfter(all, note, gate.email);
  revalidatePath("/manage/feedback");
  revalidatePath("/me");
  return { ok: true };
}
