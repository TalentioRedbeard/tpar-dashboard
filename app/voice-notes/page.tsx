// /voice-notes — list of recent voice notes. Tap one to view + generate.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { listRecentVoiceNotes } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Voice notes · TPAR-DB" };

function fmtRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default async function VoiceNotesIndex() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/voice-notes");

  const notes = await listRecentVoiceNotes(50);

  return (
    <PageShell
      kicker="Voice notes"
      title="Voice notes"
      description="Tech-recorded voice notes. Substrate for the Based-on… estimate-builder feature."
      actions={
        <Link
          href="/voice-notes/new"
          className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
        >
          + New voice note
        </Link>
      }
    >
      <Section title={`${notes.length} recent`} description="Most recent first.">
        {notes.length === 0 ? (
          <EmptyState
            title="No voice notes yet."
            description="Record your first one to capture context for an estimate or process decision."
          />
        ) : (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            {notes.map((n: any) => {
              const preview = (n.transcript ?? "").slice(0, 240);
              return (
                <li key={n.id} className="hover:bg-neutral-50">
                  <Link href={`/voice-notes/${n.id}`} className="block px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-neutral-900">
                        {n.tech_short_name ?? n.user_email ?? "—"}
                      </span>
                      <span className="text-xs text-neutral-500">{fmtRel(n.ts)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono">{n.source}</span>
                      {n.intent_tag ? <span className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-700">{n.intent_tag}</span> : null}
                      {n.audio_duration_seconds ? <span>{Math.round(n.audio_duration_seconds)}s</span> : null}
                      {n.hcp_job_id ? <Link href={`/job/${n.hcp_job_id}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>job</Link> : null}
                      {n.transcription_status !== "transcribed" ? <span className="text-amber-700">{n.transcription_status}</span> : null}
                    </div>
                    {preview ? (
                      <p className="mt-1.5 line-clamp-2 text-xs text-neutral-600">{preview}{(n.transcript?.length ?? 0) > 240 ? "…" : ""}</p>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </PageShell>
  );
}
