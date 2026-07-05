"use server";

// Server actions behind /conversation's Stew Queue section (Daily Review slice 2).
// The nightly daily-review distill maintains `open_threads` automatically; these are
// Danny's MANUAL controls: mark a stewing thread resolved (it landed) or dissolved
// (it stopped mattering), with an optional note. Owner-gated, matching the page.
// Consequence tier T1 — updates one open_threads row, appends to its history.

import { db } from "@/lib/supabase";
import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { revalidatePath } from "next/cache";

export type ThreadHistoryEntry = { date: string; action: string; note: string | null };

export type OpenThreadRow = {
  id: string;
  title: string;
  body: string | null;
  status: string;
  first_seen: string;
  last_updated: string;
  resolution: string | null;
  history: ThreadHistoryEntry[];
};

export type SettleResult = { ok: true } | { ok: false; error: string };

export async function settleThread(input: {
  id: string;
  action: "resolved" | "dissolved";
  note?: string;
}): Promise<SettleResult> {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) return { ok: false, error: "owner only" };
  if (!input.id) return { ok: false, error: "missing thread id" };
  if (input.action !== "resolved" && input.action !== "dissolved") return { ok: false, error: "bad action" };

  const supa = db();
  const { data: row, error: readErr } = await supa
    .from("open_threads")
    .select("id, status, history")
    .eq("id", input.id)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!row) return { ok: false, error: "thread not found" };
  if ((row as { status: string }).status !== "open") return { ok: false, error: "thread is no longer open" };

  const note = input.note?.trim() || null;
  // Calendar day in America/Chicago (server runs UTC on Vercel).
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const prior = Array.isArray((row as { history: unknown }).history)
    ? ((row as { history: ThreadHistoryEntry[] }).history)
    : [];
  const history = [...prior, { date: today, action: `${input.action}-manual`, note }];

  const { error } = await supa
    .from("open_threads")
    .update({
      status: input.action,
      resolution: note,
      last_updated: today,
      history,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/conversation");
  return { ok: true };
}
