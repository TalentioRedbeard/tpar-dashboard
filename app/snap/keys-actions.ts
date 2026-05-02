"use server";

// Server actions for the keystroke send-back surface (/keys, also reachable
// from /snap as a sub-section). Phase 2 of the /snap workflow.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type KeyResult =
  | { ok: true; input_id: string }
  | { ok: false; error: string };

// Allowed inputs. Restricted to keep the surface tight — if you want to
// send arbitrary keystrokes, do it from the laptop itself.
const ALLOWED = new Set([
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
  "{ENTER}", "{ESC}", "{BACKSPACE}", "{TAB}",
  "y", "n", "Y", "N",
]);

export async function requestKeystroke(input: { key: string; context?: string }): Promise<KeyResult> {
  const me = await getCurrentTech();
  if (!me?.isAdmin) {
    return { ok: false, error: "Admin only — only Danny's laptop runs the poller." };
  }
  if (!ALLOWED.has(input.key)) {
    return { ok: false, error: `Key '${input.key}' not in allowed set.` };
  }

  const supabase = db();
  const { data, error } = await supabase
    .from("pending_input")
    .insert({
      requested_by: me.email,
      key_input: input.key,
      context: input.context ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "insert failed" };
  }
  revalidatePath("/snap");
  return { ok: true, input_id: data.id as string };
}

export type RecentKey = {
  id: string;
  requested_at: string;
  key_input: string;
  status: string;
  sent_at: string | null;
  failure_reason: string | null;
};

export async function getRecentKeys(): Promise<RecentKey[]> {
  const me = await getCurrentTech();
  if (!me?.isAdmin) return [];
  const supabase = db();
  const { data } = await supabase
    .from("pending_input")
    .select("id, requested_at, key_input, status, sent_at, failure_reason")
    .order("requested_at", { ascending: false })
    .limit(10);
  return (data ?? []) as RecentKey[];
}
