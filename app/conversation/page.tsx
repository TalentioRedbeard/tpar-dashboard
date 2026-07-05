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
import { StewQueuePanel, type StewThread, type SettledThread } from "@/components/StewQueuePanel";
import type { DailyReview } from "@/app/conversation/daily-review-actions";
import type { OpenThreadRow } from "@/app/conversation/stew-actions";

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

  // Stew Queue (Daily Review slice 2): open threads oldest-first + last-14-days settlements.
  // Calendar math in America/Chicago (server runs UTC on Vercel).
  const todayChi = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const settledCutoff = new Date(Date.parse(todayChi) - 14 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: openRows }, { data: settledRows }] = await Promise.all([
    db()
      .from("open_threads")
      .select("id, title, body, status, first_seen, last_updated, resolution, history")
      .eq("status", "open")
      .order("first_seen", { ascending: true })
      .limit(100),
    db()
      .from("open_threads")
      .select("id, title, status, resolution, last_updated")
      .in("status", ["resolved", "dissolved"])
      .gte("last_updated", settledCutoff)
      .order("last_updated", { ascending: false })
      .limit(50),
  ]);
  const stewing: StewThread[] = ((openRows ?? []) as OpenThreadRow[]).map((t) => ({
    ...t,
    history: Array.isArray(t.history) ? t.history : [],
    stewing_days: Math.max(0, Math.round((Date.parse(todayChi) - Date.parse(t.first_seen)) / 86_400_000)),
  }));
  const settled = (settledRows ?? []) as SettledThread[];

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <DailyReviewPanel
        stored={storedReview}
        storedDate={(dr as { review_date: string } | null)?.review_date ?? null}
        storedSpan={(dr as { source_span: string | null } | null)?.source_span ?? null}
      />
      <StewQueuePanel open={stewing} settled={settled} />
      <ConversationPanel recent={recent} />
    </main>
  );
}
