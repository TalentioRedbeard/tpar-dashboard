"use server";

// Server action behind /conversation's Daily Review section. Calls the `daily-review`
// edge fn (distills the day's office-ambient chunks → summary / process-signals / tasks /
// open-threads / owner-context, upserts one daily_reviews row per day). Owner-gated,
// 40s bound (LLM round-trip). Consequence tier T1 — reads the day, writes only the review.

import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";

const FN_URL = "https://bwpoqsfrygyopwxmegax.supabase.co/functions/v1/daily-review";

export type ProcessSignal = { signal: string; why: string; adapt: string };
export type ReviewTask = { title: string; detail: string };
export type DailyReview = {
  summary: string;
  process_signals: ProcessSignal[];
  tasks: ReviewTask[];
  open_threads: string[];
  owner_context: string[];
};
export type DistillResult =
  | { ok: null }
  | { ok: true; review_date: string; chunk_count: number; source_span: string | null; review: DailyReview | null }
  | { ok: false; message: string };

export async function distillToday(_prev: DistillResult, _formData: FormData): Promise<DistillResult> {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) return { ok: false, message: "owner only" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40_000);
  try {
    const resp = await fetch(FN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    const j = (await resp.json().catch(() => ({}))) as {
      ok?: boolean; error?: string; review_date?: string; chunk_count?: number; source_span?: string; review?: DailyReview | null;
    };
    if (!resp.ok || !j.ok) return { ok: false, message: j.error ?? `couldn't distill (status ${resp.status})` };
    return {
      ok: true,
      review_date: j.review_date ?? "",
      chunk_count: j.chunk_count ?? 0,
      source_span: j.source_span ?? null,
      review: j.review ?? null,
    };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "timed out (>40s)" : e.message) : String(e);
    return { ok: false, message: msg };
  } finally {
    clearTimeout(timer);
  }
}
