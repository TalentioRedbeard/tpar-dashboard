// /admin/concerns — leadership review queue. Voice notes flagged for
// discussion (needs_discussion=true, unresolved). Resolve in-place with a
// short note.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { listOpenConcerns, listResolvedConcerns } from "./actions";
import { ResolveForm } from "./ResolveForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Concerns · TPAR-DB" };

function fmtAbs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const INTENT_LABELS: Record<string, string> = {
  "scheduling-issue":  "Scheduling",
  "process-concern":   "Process",
  "employee-concern":  "Employee",
  "system-issue":      "System / tool",
  "leadership-note":   "Leadership note",
  "estimate-context":  "Estimate context",
  "job-note":          "Job note",
  "process-doc":       "Process doc",
  "other":             "Other",
};

const INTENT_TONE: Record<string, string> = {
  "scheduling-issue":  "bg-amber-50 text-amber-800 ring-amber-200",
  "process-concern":   "bg-violet-50 text-violet-800 ring-violet-200",
  "employee-concern":  "bg-red-50 text-red-800 ring-red-200",
  "system-issue":      "bg-cyan-50 text-cyan-800 ring-cyan-200",
  "leadership-note":   "bg-neutral-50 text-neutral-700 ring-neutral-200",
};

export default async function ConcernsPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/admin/concerns");
  if (!me.isAdmin && !me.isManager) {
    return (
      <PageShell title="Leadership only">
        <EmptyState title="Not authorized." />
      </PageShell>
    );
  }

  const [open, resolved] = await Promise.all([
    listOpenConcerns(),
    listResolvedConcerns(15),
  ]);

  return (
    <PageShell
      kicker="Admin · Concerns"
      title="Concerns to discuss"
      description="Voice notes flagged for leadership review. Resolve with a short note when discussed."
      actions={
        <Link
          href="/voice-notes/new"
          className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
        >
          + New voice note
        </Link>
      }
    >
      <Section title={`${open.length} open`} description="Most recent first.">
        {open.length === 0 ? (
          <EmptyState
            title="No open concerns."
            description='When a manager records a voice note and ticks "Flag for discussion," it lands here.'
          />
        ) : (
          <ul className="space-y-3">
            {open.map((c) => {
              const tag = c.intent_tag ?? "other";
              const tone = INTENT_TONE[tag] ?? "bg-neutral-50 text-neutral-700 ring-neutral-200";
              return (
                <li key={c.id} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-2 py-0.5 font-medium ring-1 ring-inset ${tone}`}>{INTENT_LABELS[tag] ?? tag}</span>
                      <span className="font-medium text-neutral-800">{c.tech_short_name ?? c.user_email ?? "—"}</span>
                      <span className="text-neutral-500">{fmtAbs(c.ts)}</span>
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-600">{c.source}</span>
                    </div>
                    <Link href={`/voice-notes/${c.id}`} className="text-brand-700 hover:underline">Open note →</Link>
                  </div>
                  {c.transcript ? (
                    <div className="border-b border-neutral-100 px-4 py-3 text-sm leading-relaxed text-neutral-800">
                      <div className="whitespace-pre-wrap">{c.transcript}</div>
                    </div>
                  ) : null}
                  {c.hcp_job_id ? (
                    <div className="border-b border-neutral-100 px-4 py-2 text-xs">
                      <Link href={`/job/${c.hcp_job_id}`} className="text-brand-700 hover:underline">Linked job →</Link>
                    </div>
                  ) : null}
                  <ResolveForm id={c.id} />
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="my-6" />

      <Section title="Recently resolved" description="Last 15 — for audit / continuity.">
        {resolved.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing resolved yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            {resolved.map((c: any) => (
              <li key={c.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">resolved</span>
                    <span className="font-medium text-neutral-800">{INTENT_LABELS[c.intent_tag ?? "other"] ?? c.intent_tag}</span>
                    <span className="text-neutral-500">resolved {fmtAbs(c.discussion_resolved_at)}</span>
                  </div>
                  <Link href={`/voice-notes/${c.id}`} className="text-neutral-500 hover:underline">→</Link>
                </div>
                {c.discussion_resolution ? (
                  <div className="mt-1 text-xs text-neutral-700"><strong className="text-neutral-500">Resolution:</strong> {c.discussion_resolution}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PageShell>
  );
}
