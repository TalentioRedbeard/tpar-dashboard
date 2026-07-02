// /conversation — the talk-back loop (Danny 2026-06-30: "build the talk-back loop").
// The "avenue for active response" he named as his #1 gap: he thinks out loud (the global
// AmbientRecorder in layout.tsx is already capturing → office_notes, transcribed on-prem),
// and here he gets a contextual reply — reflection + moving questions + captured tasks — via
// the `converse` edge fn. v1 = async talk → read-reply (no interruption problem). Owner-gated.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/supabase";
import { ConversationPanel } from "@/components/ConversationPanel";
import { DailyReviewPanel } from "@/components/DailyReviewPanel";
import type { DailyReview } from "@/app/conversation/daily-review-actions";

export const dynamic = "force-dynamic";

export default async function ConversationPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");

  const sinceIso = new Date(Date.now() - 20 * 60_000).toISOString();
  const { data } = await db()
    .from("office_notes")
    .select("started_at, transcript")
    .eq("source", "office-ambient")
    .eq("transcript_status", "transcribed")
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: true })
    .limit(120);

  const recent = (data ?? [])
    .map((r) => (r as { transcript: string | null }).transcript?.trim() ?? "")
    .filter(Boolean);

  // Latest stored Daily Review (the "power center point" first slice).
  const { data: dr } = await db()
    .from("daily_reviews")
    .select("review_date, source_span, summary, process_signals, tasks, open_threads, owner_context")
    .order("review_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const storedReview: DailyReview | null = dr
    ? {
        summary: (dr as { summary: string | null }).summary ?? "",
        process_signals: (dr as { process_signals: DailyReview["process_signals"] }).process_signals ?? [],
        tasks: (dr as { tasks: DailyReview["tasks"] }).tasks ?? [],
        open_threads: (dr as { open_threads: string[] }).open_threads ?? [],
        owner_context: (dr as { owner_context: string[] }).owner_context ?? [],
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <DailyReviewPanel
        stored={storedReview}
        storedDate={(dr as { review_date: string } | null)?.review_date ?? null}
        storedSpan={(dr as { source_span: string | null } | null)?.source_span ?? null}
      />
      <ConversationPanel recent={recent} />
    </main>
  );
}
