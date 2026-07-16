// /comms/[id] — detail view for a single communication_events row.
// Shows full transcript + audio link + sentiment + flags + the AI summary.
// Created to support /me/coaching's listen-links (2026-05-14).

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { getCurrentTech } from "../../../lib/current-tech";
import { techWorkedCustomer, techWorkedJob } from "../../../lib/tech-scope";
import { ProvenanceCard, type ProvenanceItem } from "../../../components/ui/ProvenanceCard";

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

  // Tech scope guard: a TECHNICIAN may only open a transcript for a customer or
  // job whose work they were on — the canonical rule (lib/tech-scope), full
  // history, fail closed. (The old name+±90d-window gate would block the
  // full-history search hits the A7 list now surfaces.) Without this a tech
  // could id-walk /comms/<n> and read EVERY customer's call transcripts + text
  // bodies (db() is service-role, so RLS doesn't gate it). Admin/manager keep
  // full access. (Audit 2026-06-12; rebased 2026-07-16.)
  if (!me.isAdmin && !me.isManager) {
    const empId = me.tech?.hcp_employee_id ?? null;
    let inScope = false;
    if (empId) {
      if (e.hcp_customer_id) inScope = await techWorkedCustomer(empId, e.hcp_customer_id);
      if (!inScope && e.hcp_job_id) inScope = await techWorkedJob(empId, e.hcp_job_id);
    }
    if (!inScope) {
      return (
        <PageShell title="Outside your scope" backHref="/comms" backLabel="My comms">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-800">
            This conversation isn&apos;t with one of your scheduled customers, so it&apos;s outside what you can view. If you think you should have access, ask Danny.
          </div>
        </PageShell>
      );
    }
  }

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

      <div className="mt-6">
        <ProvenanceCard
          items={[
            {
              section: "communication_events row",
              source_fn: e.source_table === "call_transcripts"
                ? "transcribe-and-store-call"
                : e.source_table === "text_messages"
                  ? "store-text-message"
                  : e.source_table === "emails_received"
                    ? "pull-gmail"
                    : "summarize-communication-events",
              tables: ["communication_events"],
              last_ts: e.occurred_at,
              count: 1,
              note: e.source_table ? `mirrored from ${e.source_table} #${e.source_id}` : undefined,
            },
            ...(e.source_table === "call_transcripts"
              ? [{
                  section: "Underlying call transcript",
                  source_fn: "transcribe-and-store-call",
                  tables: ["call_transcripts"],
                  last_ts: e.occurred_at,
                  count: 1,
                  note: audioUrl ? "Whisper transcript + HCP-mirrored audio URL" : "Whisper transcript",
                } as ProvenanceItem]
              : []),
            ...(e.source_table === "text_messages"
              ? [{
                  section: "Underlying Sendbird text",
                  source_fn: "store-text-message",
                  tables: ["text_messages"],
                  last_ts: e.occurred_at,
                  count: 1,
                  note: "captured by tpar-hcp-bot extract-texts",
                } as ProvenanceItem]
              : []),
            {
              section: "AI summary + sentiment + flags",
              source_fn: "summarize-communication-events",
              tables: ["communication_events"],
              last_ts: e.summary ? e.occurred_at : null,
              count: e.summary ? 1 : 0,
              note: e.summary ? undefined : "not yet summarized",
            },
          ]}
        />
      </div>
    </PageShell>
  );
}
