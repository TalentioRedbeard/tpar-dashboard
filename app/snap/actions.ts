"use server";

// Server action for manual "snap my laptop" requests.
// Inserts a row into screenshot_requests; the local PowerShell poller
// picks it up and DMs the screenshot.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type SnapResult =
  | { ok: true; request_id: string }
  | { ok: false; error: string };

export async function requestScreenshot(input: { context?: string } = {}): Promise<SnapResult> {
  const me = await getCurrentTech();
  if (!me?.isAdmin) {
    // Phase 1 is admin-only; the laptop being snapped is Danny's.
    // Future: per-tech polling on per-tech laptops would generalize this.
    return { ok: false, error: "Admin only — only Danny's laptop runs the poller right now." };
  }

  const supabase = db();
  const { data, error } = await supabase
    .from("screenshot_requests")
    .insert({
      requested_by: me.email,
      context: input.context ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "insert failed" };
  }
  revalidatePath("/snap");
  return { ok: true, request_id: data.id as string };
}

export type RecentRequest = {
  id: string;
  requested_at: string;
  requested_by: string;
  context: string | null;
  status: string;
  picked_up_at: string | null;
  captured_at: string | null;
  screenshot_url: string | null;
  failure_reason: string | null;
};

export async function getRecentRequests(): Promise<RecentRequest[]> {
  const me = await getCurrentTech();
  if (!me?.isAdmin) return [];
  const supabase = db();
  const { data } = await supabase
    .from("screenshot_requests")
    .select("id, requested_at, requested_by, context, status, picked_up_at, captured_at, screenshot_url, failure_reason")
    .order("requested_at", { ascending: false })
    .limit(10);
  return (data ?? []) as RecentRequest[];
}
