// /admin/knowledge-gaps — triage queue for "I don't know" answers from ask-tpar.
//
// When a field_support question goes unanswered (no_match against tpar_contacts
// or tpar_kb_entries), appguide-route captures a knowledge_gaps row. Danny
// triages by converting each into a contact or a KB entry.

import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { getCurrentTech } from "../../../lib/current-tech";

export const metadata = { title: "Knowledge gaps · TPAR-DB" };
export const dynamic = "force-dynamic";

type Gap = {
  id: string;
  captured_at: string;
  question: string;
  asker_email: string | null;
  asker_short_name: string | null;
  suggested_kind: string | null;
  resolution_status: string;
  occurrence_count: number;
};

type RecentNoMatch = {
  id: string;
  asked_at: string;
  asker_short_name: string | null;
  asker_email: string | null;
  question: string;
  surfaces_used: string[];
};

export default async function KnowledgeGapsPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/admin/knowledge-gaps");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  const supa = db();
  const [gapsRes, recentNoMatchRes, contactCount, kbCount] = await Promise.all([
    supa.from("knowledge_gaps")
      .select("id, captured_at, question, asker_email, asker_short_name, suggested_kind, resolution_status, occurrence_count")
      .eq("resolution_status", "open")
      .order("occurrence_count", { ascending: false })
      .order("captured_at", { ascending: false })
      .limit(50),
    supa.from("ask_interactions")
      .select("id, asked_at, asker_short_name, asker_email, question, surfaces_used")
      .eq("answer_source", "no_match")
      .gte("asked_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
      .order("asked_at", { ascending: false })
      .limit(30),
    supa.from("tpar_contacts").select("id", { count: "exact", head: true }).eq("status", "active"),
    supa.from("tpar_kb_entries").select("id", { count: "exact", head: true }),
  ]);

  const gaps = (gapsRes.data ?? []) as Gap[];
  const recentNoMatch = (recentNoMatchRes.data ?? []) as RecentNoMatch[];

  return (
    <PageShell
      title="Knowledge gaps"
      description={`${gaps.length} open gap${gaps.length === 1 ? "" : "s"} · ${contactCount.count ?? 0} contacts · ${kbCount.count ?? 0} KB entries`}
      help={{
        intent: "Every time someone asks /ask and we say 'I don't know,' the gap is captured here. Triage by adding a contact or a KB entry, then mark resolved.",
        actions: [
          "Open gaps are sorted by occurrence_count (most-asked first), then recency.",
          "Each gap shows the question + who asked + how many times.",
          "Recent no-match (bottom) shows raw ask_interactions that haven't been gap-captured yet — useful for spotting patterns.",
        ],
      }}
    >
      <div className="space-y-8">
        {/* Open gaps */}
        <section>
          <h2 className="mb-2 text-base font-semibold text-neutral-900">Open gaps</h2>
          {gaps.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
              No open knowledge gaps. Good problem to have — either the directory is complete, or nobody&apos;s asked yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {gaps.map((g) => (
                <li key={g.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-amber-900">“{g.question}”</span>
                    {g.occurrence_count > 1 ? (
                      <span className="rounded-md bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">asked {g.occurrence_count}×</span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs text-amber-800">
                    asked by {g.asker_short_name ?? g.asker_email ?? "?"}
                    {" · "}captured {new Date(g.captured_at).toLocaleString()}
                    {g.suggested_kind ? ` · likely a ${g.suggested_kind}` : ""}
                  </div>
                  <div className="mt-2 flex gap-2 text-[11px]">
                    <span className="text-amber-700">Resolve by:</span>
                    <span className="text-amber-800">add a tpar_contacts row, then update knowledge_gaps SET resolution_status=&apos;resolved&apos;, resolution_contact_id=&lt;id&gt;</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent no-match (raw) */}
        <section>
          <h2 className="mb-2 text-base font-semibold text-neutral-900">Recent &quot;no match&quot; queries (last 14d)</h2>
          {recentNoMatch.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
              No no-match queries logged yet. Either nobody&apos;s asked support questions through /ask, or every question hit the directory.
            </div>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {recentNoMatch.map((r) => (
                <li key={r.id} className="rounded-lg border border-neutral-200 bg-white p-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-neutral-800">{r.question}</span>
                    <span className="font-mono text-[10px] text-neutral-500">{new Date(r.asked_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-600">
                    {r.asker_short_name ?? r.asker_email ?? "anon"}
                    {r.surfaces_used.length > 0 ? ` · tried ${r.surfaces_used.join(", ")}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs text-neutral-500">
          ⚙ Add/edit UI not yet shipped — for now, write directly to <code>tpar_contacts</code> /{" "}
          <code>tpar_kb_entries</code> via SQL, or ask Danny to add via memory. <Link href="/contacts" className="underline">Browse current contacts →</Link>
        </p>
      </div>
    </PageShell>
  );
}
