"use server";

// Dev voice inbox actions (phone→dev tether Rung 1, SPEC_2026-07-15).
// Owner-only: spoken development thoughts are Danny's working notes.
// Promote-to-task mirrors the flags pattern (ref_kind='dev_voice').

import { db } from "@/lib/supabase";
import { requireOwner } from "@/lib/current-tech";

export type DevInboxRow = {
  id: number;
  source: string;
  call_sid: string | null;
  transcript: string;
  reply: string | null;
  status: string;
  created_at: string;
};

export async function listDevInbox(): Promise<{ ok: true; rows: DevInboxRow[] } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { data, error } = await db()
    .from("dev_voice_inbox")
    .select("id, source, call_sid, transcript, reply, status, created_at")
    .in("status", ["new", "picked", "replied"])
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as DevInboxRow[] };
}

export async function devInboxVerb(input: {
  id: number;
  verb: "done" | "dismissed" | "promoted";
}): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  const supa = db();

  const { data: row, error: rowErr } = await supa
    .from("dev_voice_inbox")
    .select("id, transcript, reply, source, status")
    .eq("id", input.id)
    .maybeSingle();
  if (rowErr || !row) return { ok: false, error: rowErr?.message ?? "row not found" };

  if (input.verb === "promoted") {
    const { error: taskErr } = await supa.from("tasks").insert({
      title: `Dev (voice): ${String(row.transcript).slice(0, 280)}`,
      detail: `${row.transcript}${row.reply ? `\n\nClaude's reply so far:\n${row.reply}` : ""}\n(spoken via the ${row.source} lane; promoted by ${gate.email})`.slice(0, 4000),
      status: "open",
      created_by: "dev-inbox-promote",
      ref_kind: "dev_voice",
      ref_id: String(row.id),
      requirements: [],
    });
    if (taskErr && (taskErr as { code?: string }).code !== "23505") {
      return { ok: false, error: taskErr.message };
    }
  }

  const status = input.verb === "promoted" ? "done" : input.verb;
  const { error } = await supa
    .from("dev_voice_inbox")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", input.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
