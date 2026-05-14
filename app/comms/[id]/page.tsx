// /comms/[id] — detail view for a single communication_events row.
// Shows full transcript + audio link + sentiment + flags + the AI summary.
// Created to support /me/coaching's listen-links (2026-05-14).

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { getCurrentTech } from "../../../lib/current-tech";

export const dynamic = "force-dynamic";

type CommEvent = {
  id: number;
  occurred_at: string;
  channel: string | null;
  direction: string | null;
  customer_name: string | null;
  hcp_customer_id: string | null;
  hcp_job_id: string | null;
  hcp_employee_id: string | null;
  tech_short_name: string | null;
  counterparty: string | null;
  duration_sec: number | null;
  content_text: string | null;
  summary: string | null;
  topics: string[] | null;
  sentiment: string | null;
  flags: string[] | null;
  importance: number | null;
  source_table: string | null;
  source_id: number | null;
  raw_metadata: Record<string, unknown> | null;
};

function fmtChi(s: string): string {
  return new Date(s).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "long", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function fmtDuration(sec: number | null): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function CommDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentTech();
  if (!me) redirect("/login");

  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId)) notFound();

  const supa = db();
  const { data: event } = await supa
    .from("communication_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) notFound();
  const e = event as CommEvent;

  // Look up the underlying call_transcripts row (for audio URL) if this is a call
  let audioUrl: string | null = null;
  if (e.source_table === "call_transcripts" && e.source_id) {
    const { data: tr } = await supa
      .from("call_transcripts")
      .select("audio_url")
      .eq("id", e.source_id)
      .maybeSingle();
    audioUrl = (tr as { audio_url: string | null } | null)?.audio_url ?? null;
  }

  return (
    <PageShell
      title={`Comm #${e.id} — ${e.customer_name ?? "—"}`}
      description={`${fmtChi(e.occurred_at)} · ${(e.channel ?? "?").toUpperCase()} · ${e.direction ?? "—"}${e.duration_sec ? ` · ${fmtDuration(e.duration_sec)}` : ""}`}
      backHref="/comms"
      backLabel="All comms"
    >
      {/* metadata strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Tech</div>
          <div className="mt-1 text-lg font-semibold text-neutral-900">{e.tech_short_name ?? "—"}</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Importance</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-neutral-900">{e.importance ?? "—"}</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Sentiment</div>
          <div className="mt-1 text-lg font-semibold text-neutral-900">{e.sentiment ?? "—"}</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Channel</div>
          <div className="mt-1 text-lg font-semibold text-neutral-900">
            {e.channel?.toUpperCase() ?? "—"}{e.duration_sec ? ` · ${fmtDuration(e.duration_sec)}` : ""}
          </div>
        </div>
      </div>

      {/* links */}
      <div className="mb-6 flex flex-wrap items-baseline gap-3 text-sm">
        {e.hcp_customer_id && (
          <Link href={`/customer/${e.hcp_customer_id}`} className="rounded-md bg-neutral-100 px-2 py-1 text-neutral-800 hover:bg-neutral-200">
            → Customer profile
          </Link>
        )}
        {e.hcp_job_id && (
          <Link href={`/job/${e.hcp_job_id}`} className="rounded-md bg-neutral-100 px-2 py-1 text-neutral-800 hover:bg-neutral-200">
            → Open job
          </Link>
        )}
        {audioUrl && (
          <a href={audioUrl} target="_blank" rel="noopener noreferrer" className="rounded-md bg-brand-100 px-2 py-1 text-brand-800 hover:bg-brand-200">
            🎧 Listen to audio
          </a>
        )}
      </div>

      {/* summary + flags */}
      {e.summary && (
        <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-600">AI summary</h2>
          <p className="text-neutral-900">{e.summary}</p>
          {e.flags && e.flags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {e.flags.map((f) => (
                <span key={f} className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{f}</span>
              ))}
            </div>
          )}
          {e.topics && e.topics.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {e.topics.map((t) => (
                <span key={t} className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">{t}</span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* full transcript */}
      {e.content_text && (
        <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-600">Full transcript</h2>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-800">{e.content_text}</pre>
        </section>
      )}

      {/* raw metadata (collapsed) */}
      {e.raw_metadata && (
        <details className="rounded-2xl border border-neutral-200 bg-white p-4">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-neutral-600">Raw metadata</summary>
          <pre className="mt-2 overflow-auto text-xs text-neutral-700">{JSON.stringify(e.raw_metadata, null, 2)}</pre>
        </details>
      )}
    </PageShell>
  );
}
