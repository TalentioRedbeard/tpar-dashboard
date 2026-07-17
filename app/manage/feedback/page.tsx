// /manage/feedback — the daily feedback sitting (spec §3c). Every distilled
// wrap item waits here until a human answers it with one of three verbs; the
// answer lands on the tech's /me (and their Slack DM). The header carries the
// participation strip — who's wrapping — management-only, invite-never-compel
// tone (neutral "not yet", never "missing", never sorted by misses).
// Gate = the /manage layout (admin + manager; view-as vanishes the section).
// Flags + schedule requests stay on their own canonical queues — count chips
// here are DOORS, not duplicate items (one watcher per condition).

import Link from "next/link";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { FeedbackQueue, type QueueItem } from "./FeedbackQueue";

export const dynamic = "force-dynamic";
export const metadata = { title: "Feedback · Manage · TPAR-DB" };

const CHI = "America/Chicago";
const chiToday = () => new Date().toLocaleDateString("en-CA", { timeZone: CHI });

type ItemRow = {
  id: string; tech: string; source_kind: string; wrap_date: string; summary: string;
  category: string | null; cluster_key: string | null; suggested_response: string | null;
  created_at: string; status: string;
};
type PartRow = { day: string; tech_short_name: string; wrapped: boolean };

export default async function ManageFeedbackPage() {
  const supa = db();
  const today = chiToday();

  const [openRes, partRes, flagsRes, schedRes, answeredRes, rosterRes] = await Promise.all([
    supa.from("feedback_items")
      .select("id, tech, source_kind, wrap_date, summary, category, cluster_key, suggested_response, created_at, status")
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(200),
    supa.from("wrap_participation_v").select("day, tech_short_name, wrapped").order("day", { ascending: false }),
    supa.from("data_flags").select("id", { count: "exact", head: true }).in("status", ["open", "in_review"]),
    supa.from("tasks").select("id", { count: "exact", head: true }).eq("ref_kind", "wrap_schedule_request").in("status", ["open", "in_progress"]),
    supa.from("feedback_items")
      .select("id, tech, response_kind, responded_at")
      .not("responded_at", "is", null)
      .gte("responded_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order("responded_at", { ascending: false })
      .limit(50),
    supa.from("tech_directory").select("tech_short_name").eq("is_active", true).eq("dashboard_role", "tech").order("tech_short_name"),
  ]);

  const dayMs = 86_400_000;
  const items: QueueItem[] = ((openRes.data ?? []) as ItemRow[]).map((r) => ({
    id: r.id,
    tech: r.tech,
    sourceKind: r.source_kind,
    wrapDate: r.wrap_date,
    summary: r.summary,
    category: r.category,
    clusterKey: r.cluster_key,
    suggestedResponse: r.suggested_response,
    ageDays: Math.max(0, Math.floor((Date.now() - new Date(r.created_at).getTime()) / dayMs)),
    isKudos: r.category === "kudos" || r.source_kind === "wrap_highlight",
  }));

  const part = (partRes.data ?? []) as PartRow[];
  const days = [...new Set(part.map((p) => p.day))].sort().reverse();
  const strip = (day: string) => part.filter((p) => p.day === day).sort((a, b) => a.tech_short_name.localeCompare(b.tech_short_name));
  const last7 = days.slice(0, 7).reverse();
  const techRoster = [...new Set(part.map((p) => p.tech_short_name))].sort();
  const wrappedOn = new Set(part.filter((p) => p.wrapped).map((p) => `${p.tech_short_name}|${p.day}`));

  const answered = (answeredRes.data ?? []) as Array<{ id: string; response_kind: string | null }>;
  const techNames = ((rosterRes.data ?? []) as Array<{ tech_short_name: string }>).map((t) => t.tech_short_name);
  const openNonKudos = items.filter((i) => !i.isKudos);
  const todayStrip = strip(today);

  return (
    <PageShell
      kicker="Manage"
      title="Feedback loop"
      description="Every wrap item gets an answer: reply, make it a task, or say why not. The answer lands on the tech's Home page — that loop is why they keep talking."
      backHref="/manage"
      backLabel="← Manage"
      help={{
        intent: "Your daily sitting: answer every piece of tech feedback with one of three verbs. Drafts are pre-written — edit and send in your own words.",
        actions: [
          "Reply — the draft is a starting point; it sends under your name.",
          "Make a task — turns the ask into tracked work; fold repeat asks into ONE task with the checkboxes.",
          "Can't do it — the honest no, with the why. Techs respect a real answer more than silence.",
          "Good words (kudos) have no rot clock — send thanks when you feel it.",
          "The strip up top shows who's wrapping. No leaderboards — participation grows because feedback gets ANSWERED.",
        ],
        stuck: <>An item with no draft just means the AI triage skipped it — write the answer yourself, everything else works the same.</>,
      }}
    >
      {/* Participation strip — management-only; neutral tone by design. */}
      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-neutral-800">🎙️ Wraps today:</span>
          <span className="font-bold text-brand-900">{todayStrip.filter((p) => p.wrapped).length}/{todayStrip.length}</span>
          {todayStrip.map((p) => (
            <span key={p.tech_short_name}
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.wrapped ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-500"}`}>
              {p.tech_short_name}{p.wrapped ? " ✓" : " · not yet"}
            </span>
          ))}
        </div>
        {/* 7-day dot strip per tech */}
        <div className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {techRoster.map((t) => (
            <div key={t} className="flex items-center gap-2 text-xs text-neutral-600">
              <span className="w-16 truncate">{t}</span>
              <span className="flex gap-1">
                {last7.map((d) => (
                  <span key={d} title={d}
                    className={`inline-block h-2 w-2 rounded-full ${wrappedOn.has(`${t}|${d}`) ? "bg-emerald-500" : "bg-neutral-200"}`} />
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-neutral-400">Other queues:</span>
          <Link href="/manage/flags" className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100">
            🚩 {flagsRes.count ?? 0} flags
          </Link>
          <Link href="/manage" className="rounded-full bg-brand-50 px-2.5 py-1 font-medium text-brand-800 ring-1 ring-inset ring-brand-200 hover:bg-brand-100">
            🗓️ {schedRes.count ?? 0} schedule requests
          </Link>
          <span className="ml-auto text-neutral-400">
            {answered.length} answered in the last 7d{openNonKudos.length ? ` · ${openNonKudos.length} waiting` : ""}
          </span>
        </div>
      </section>

      <FeedbackQueue items={items} techNames={techNames} />
    </PageShell>
  );
}
