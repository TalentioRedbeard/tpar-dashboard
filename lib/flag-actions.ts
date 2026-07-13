"use server";

// Flag-anything server actions (build plan 2026-07-13 section 2.3).
// Doctrine: a flag is a NOTICING; a task is a COMMITMENT. Flags never gate
// any pipeline. Raising = any staff (requireResolver — techs very much
// included; Danny: "if they see something they think is wrong, I wanna know
// what and why"). Adjudicating = management only (requireManagement — server
// actions self-authorize; the gallery lesson).

import { db } from "./supabase";
import { requireResolver, requireManagement } from "./current-tech";
import { FLAG_TYPES, flagEntityHref } from "./flag-types";

export type RaiseFlagResult =
  | { ok: true; id: number; already: boolean }
  | { ok: false; error: string };

export async function raiseFlag(input: {
  entityType: string;
  entityId: string;
  entityLabel: string;
  flagType: string;
  note: string;
}): Promise<RaiseFlagResult> {
  const auth = await requireResolver();
  if (!auth.ok) return { ok: false, error: auth.error };

  const note = String(input.note ?? "").trim();
  if (!note) return { ok: false, error: "Say what and why — a flag needs its reason." };
  if (!FLAG_TYPES.some((t) => t.key === input.flagType)) {
    return { ok: false, error: "Unknown flag type." };
  }
  if (!input.entityType || !input.entityId) return { ok: false, error: "Missing entity." };

  const { data, error } = await db()
    .from("data_flags")
    .insert({
      entity_type: input.entityType,
      entity_id: input.entityId,
      entity_label: String(input.entityLabel ?? "").slice(0, 200) || null,
      flag_type: input.flagType,
      note: note.slice(0, 2000),
      source: "human",
      created_by: auth.email,
    })
    .select("id")
    .single();

  if (error) {
    // One LIVE flag per (entity, type): re-raising folds into the existing
    // flag instead of ballooning the queue — append the new why.
    if ((error as { code?: string }).code === "23505") {
      const { data: existing } = await db()
        .from("data_flags")
        .select("id, note")
        .eq("entity_type", input.entityType)
        .eq("entity_id", input.entityId)
        .eq("flag_type", input.flagType)
        .in("status", ["open", "in_review"])
        .maybeSingle();
      if (existing) {
        await db()
          .from("data_flags")
          .update({
            note: `${existing.note}\n— also (${auth.email.split("@")[0]}): ${note}`.slice(0, 2000),
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        return { ok: true, id: existing.id as number, already: true };
      }
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data.id as number, already: false };
}

export type AdjudicateResult = { ok: true } | { ok: false; error: string };

export async function adjudicateFlag(input: {
  id: number;
  verb: "resolved" | "dismissed" | "promoted" | "needs_danny";
  resolutionNote?: string;
}): Promise<AdjudicateResult> {
  const auth = await requireManagement();
  if (!auth.ok) return { ok: false, error: auth.error };

  const supa = db();
  const { data: flag, error: loadErr } = await supa
    .from("data_flags").select("*").eq("id", input.id).maybeSingle();
  if (loadErr || !flag) return { ok: false, error: loadErr?.message ?? "Flag not found." };
  if (!["open", "in_review"].includes(flag.status as string)) {
    return { ok: false, error: "Flag already settled." };
  }

  const now = new Date().toISOString();
  const resolutionNote = String(input.resolutionNote ?? "").trim() || null;

  if (input.verb === "needs_danny") {
    const { error } = await supa.from("data_flags").update({
      status: "in_review",
      assigned_to: "ddunlop@tulsapar.com",
      resolution_note: resolutionNote,
      updated_at: now,
    }).eq("id", input.id);
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  if (input.verb === "promoted") {
    // Promote-to-task is real on day one: an EXISTING-tasks-table row with
    // ref linkage. The reverse edge (task-done -> flag-resolve) is
    // deliberately NOT built — that's task system #2's hook.
    const href = flagEntityHref({ entity_type: flag.entity_type as string, entity_id: flag.entity_id as string });
    const { data: task, error: taskErr } = await supa.from("tasks").insert({
      title: `Flag: ${flag.flag_type} — ${(flag.entity_label as string | null) ?? flag.entity_id}`.slice(0, 300),
      detail: `${flag.note}${href ? `\n${href}` : ""}\n(raised by ${flag.created_by}; promoted by ${auth.email})`.slice(0, 4000),
      status: "open",
      created_by: "flag-promote",
      ref_kind: "data_flag",
      ref_id: String(flag.id),
      requirements: [],
    }).select("id").single();
    if (taskErr && (taskErr as { code?: string }).code !== "23505") {
      return { ok: false, error: taskErr.message };
    }
    const { error } = await supa.from("data_flags").update({
      status: "promoted",
      task_id: (task?.id as string | undefined) ?? null,
      resolution_note: resolutionNote ?? "Made a task",
      resolved_by: auth.email,
      resolved_at: now,
      updated_at: now,
    }).eq("id", input.id);
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  // resolved | dismissed
  const { error } = await supa.from("data_flags").update({
    status: input.verb,
    resolution_note: resolutionNote ?? (input.verb === "dismissed" ? "Not a problem" : "Fixed"),
    resolved_by: auth.email,
    resolved_at: now,
    updated_at: now,
  }).eq("id", input.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
