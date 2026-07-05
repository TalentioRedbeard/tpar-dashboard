"use server";

// Server actions behind /conversation's Team Wraps + Owner Context sections
// (power-center-point slices 4 + 3). Owner-gated, matching the page.
//   - makeTaskFromWrap: promote one requirement out of a tech's distilled daily
//     wrap into the tasks table (the "funnel of requirement" — nothing
//     auto-assigns; the owner presses the button).
//   - reviewOwnerContext: the keep/reject review gate on owner-context notes
//     extracted by the on-prem worker.
// Consequence tier T1 — one insert / one row update per press.

import { db } from "@/lib/supabase";
import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { revalidatePath } from "next/cache";

export type WrapActionResult = { ok: true } | { ok: false; error: string };

// The client passes the wrap id + requirement INDEX (not the text) — the action
// re-reads tech_daily_wraps server-side so the task always reflects what the
// distill actually stored, not whatever the browser rendered.
export async function makeTaskFromWrap(input: { wrapId: string; reqIndex: number }): Promise<WrapActionResult> {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) return { ok: false, error: "owner only" };
  if (!input.wrapId || !Number.isInteger(input.reqIndex) || input.reqIndex < 0) {
    return { ok: false, error: "bad request" };
  }

  const supa = db();
  const { data: wrap, error: readErr } = await supa
    .from("tech_daily_wraps")
    .select("id, wrap_date, tech, recording_id, requirements")
    .eq("id", input.wrapId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!wrap) return { ok: false, error: "wrap not found" };

  const reqs = Array.isArray(wrap.requirements)
    ? (wrap.requirements as Array<{ area?: string; text?: string }>)
    : [];
  const req = reqs[input.reqIndex];
  const text = String(req?.text ?? "").trim();
  if (!text) return { ok: false, error: "requirement not found" };
  const area = String(req?.area ?? "other").trim() || "other";

  const { error } = await supa.from("tasks").insert({
    title: text.slice(0, 120),
    detail: `From ${wrap.tech}'s daily wrap ${wrap.wrap_date} (${area}): ${text}`,
    source: "daily-wrap",
    created_by: user.email,
    ref_kind: "recording",
    ref_id: wrap.recording_id,
    status: "open",
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/conversation");
  return { ok: true };
}

export async function reviewOwnerContext(input: { id: string; decision: "kept" | "rejected" }): Promise<WrapActionResult> {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) return { ok: false, error: "owner only" };
  if (!input.id) return { ok: false, error: "missing id" };
  if (input.decision !== "kept" && input.decision !== "rejected") return { ok: false, error: "bad decision" };

  const supa = db();
  // Guard on status so a stale double-press can't flip an already-reviewed note.
  const { data, error } = await supa
    .from("owner_context")
    .update({ status: input.decision, reviewed_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("status", "pending_review")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "already reviewed — refresh the page" };

  revalidatePath("/conversation");
  return { ok: true };
}
