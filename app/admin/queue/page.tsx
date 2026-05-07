// /admin/queue — unified triage surface for follow-up items across channels.
//
// Sources:
//   - communication_events (calls / texts / voice notes)  → kind="event"
//   - emails_received      (Gmail ingest, business-classified by default) → kind="email"
//
// Per-item actions write acked_at + acked_by + acked_disposition for audit.
// Bulk-sweep handles low-importance long tail on the events side; emails are
// fewer and triaged individually.
//
// Pre-condition Danny named for opening email ingest: "clear the current
// follow-up queue, then start using the app myself." Both surfaces ride on
// the same triage UI so the queue stays one place.

import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/supabase";
import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueueItemActions } from "./QueueItemActions";
import { BulkSweepButton } from "./BulkSweepButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Queue · Admin · TPAR-DB" };

type EventRow = {
  kind: "event";
  id: string;
  occurred_at: string;
  channel: string;        // 'call' | 'text' | 'voice' | etc.
  direction: string | null;
  customer_name: string | null;
  tech_short_name: string | null;
  hcp_job_id: string | null;
  hcp_customer_id: string | null;
  importance: number;
  flags: string[];
  summary: string | null;
};

type EmailRow = {
  kind: "email";
  id: string;
  occurred_at: string;             // = received_at
  channel: "email";
  direction: "inbound";
  customer_name: string | null;    // = from_name or from_address
  from_address: string | null;
  subject: string | null;
  importance: number;
  flags: string[];
  summary: string | null;
  ai_intent: string | null;
  ai_classification: string | null;
};

type Row = EventRow | EmailRow;

function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function fmtAbs(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function importanceBadge(imp: number): { cls: string; label: string } {
  if (imp >= 8) return { cls: "bg-red-50 text-red-700 ring-red-200", label: `${imp}` };
  if (imp >= 7) return { cls: "bg-amber-50 text-amber-800 ring-amber-200", label: `${imp}` };
  if (imp >= 6) return { cls: "bg-yellow-50 text-yellow-800 ring-yellow-200", label: `${imp}` };
  return { cls: "bg-neutral-50 text-neutral-700 ring-neutral-200", label: `${imp}` };
}

function flagBadges(flags: string[] | null): React.ReactNode {
  if (!flags || flags.length === 0) return null;
  const interesting = flags.filter((f) => ["needs_followup", "unresolved", "escalation_needed", "new_lead", "paid_acquisition", "complaint", "warranty"].includes(f));
  return (
    <span className="flex flex-wrap gap-1">
      {interesting.map((f) => (
        <span key={f} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700 ring-1 ring-inset ring-neutral-200">
          {f}
        </span>
      ))}
    </span>
  );
}

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");

  const sp = await searchParams;
  const showAll = sp.show === "all";

  const supa = db();
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();

  // ── Communication events (calls/texts/voice) ──────────────────────────────
  const eventsP = supa
    .from("communication_events")
    .select("id, occurred_at, channel, direction, customer_name, tech_short_name, hcp_job_id, hcp_customer_id, importance, flags, summary")
    .gte("occurred_at", since)
    .gte("importance", 5)
    .is("acked_at", null)
    .overlaps("flags", ["needs_followup", "unresolved", "escalation_needed"])
    .limit(300);

  // ── Emails ────────────────────────────────────────────────────────────────
  // Default: only business-classified (or unclassified, e.g. classifier failed).
  // ?show=all bypasses the filter to surface personal/legal/noise too.
  let emailsQuery = supa
    .from("emails_received")
    .select("id, received_at, from_address, from_name, subject, ai_classification, ai_intent, ai_summary, ai_importance, ai_flags")
    .gte("received_at", since)
    .is("acked_at", null)
    .gte("ai_importance", 5)
    .limit(300);
  if (!showAll) {
    emailsQuery = emailsQuery.or("ai_classification.eq.business,ai_classification.is.null");
  }

  const [eventsRes, emailsRes] = await Promise.all([eventsP, emailsQuery]);

  const events: EventRow[] = (eventsRes.data ?? []).map((r: Record<string, unknown>) => ({
    kind: "event",
    id: String(r.id),
    occurred_at: String(r.occurred_at),
    channel: String(r.channel ?? ""),
    direction: r.direction == null ? null : String(r.direction),
    customer_name: r.customer_name == null ? null : String(r.customer_name),
    tech_short_name: r.tech_short_name == null ? null : String(r.tech_short_name),
    hcp_job_id: r.hcp_job_id == null ? null : String(r.hcp_job_id),
    hcp_customer_id: r.hcp_customer_id == null ? null : String(r.hcp_customer_id),
    importance: Number(r.importance ?? 0),
    flags: Array.isArray(r.flags) ? (r.flags as string[]) : [],
    summary: r.summary == null ? null : String(r.summary),
  }));

  const emails: EmailRow[] = (emailsRes.data ?? []).map((r: Record<string, unknown>) => ({
    kind: "email",
    id: String(r.id),
    occurred_at: String(r.received_at),
    channel: "email",
    direction: "inbound",
    customer_name: (r.from_name ? String(r.from_name) : null) ?? (r.from_address ? String(r.from_address) : null),
    from_address: r.from_address == null ? null : String(r.from_address),
    subject: r.subject == null ? null : String(r.subject),
    importance: Number(r.ai_importance ?? 0),
    flags: Array.isArray(r.ai_flags) ? (r.ai_flags as string[]) : [],
    summary: r.ai_summary == null ? null : String(r.ai_summary),
    ai_intent: r.ai_intent == null ? null : String(r.ai_intent),
    ai_classification: r.ai_classification == null ? null : String(r.ai_classification),
  }));

  const queue: Row[] = [...events, ...emails].sort((a, b) => {
    if (b.importance !== a.importance) return b.importance - a.importance;
    return new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
  });

  const high = queue.filter((r) => r.importance >= 7);
  const mid  = queue.filter((r) => r.importance === 6);
  const low  = queue.filter((r) => r.importance === 5);
  const sweepable = queue.filter((r) => r.kind === "event" && r.importance <= 6 && (Date.now() - new Date(r.occurred_at).getTime()) > 7 * 86400_000);

  const eventCount = events.length;
  const emailCount = emails.length;

  const startOfDayUtc = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").toISOString();
  const [{ count: eventsAcked }, { count: emailsAcked }] = await Promise.all([
    supa.from("communication_events").select("id", { count: "exact", head: true }).gte("acked_at", startOfDayUtc),
    supa.from("emails_received").select("id", { count: "exact", head: true }).gte("acked_at", startOfDayUtc),
  ]);
  const ackedToday = (eventsAcked ?? 0) + (emailsAcked ?? 0);

  return (
    <PageShell
      kicker="Admin"
      title="Follow-up queue"
      description={
        <>
          Unified triage across channels. <em>Done</em> = worked it · <em>Handled</em> = handled elsewhere · <em>Dismiss</em> = classifier noise.
        </>
      }
      backHref="/admin"
      backLabel="Admin home"
    >
      <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm">
        <span><strong className="tabular-nums">{queue.length}</strong> open</span>
        <span className="text-neutral-500">|</span>
        <span><strong className="tabular-nums text-red-700">{high.length}</strong> importance ≥ 7</span>
        <span><strong className="tabular-nums text-yellow-700">{mid.length}</strong> imp 6</span>
        <span><strong className="tabular-nums text-neutral-600">{low.length}</strong> imp 5</span>
        <span className="text-neutral-500">|</span>
        <span className="text-neutral-700"><strong className="tabular-nums">{eventCount}</strong> calls/texts</span>
        <span className="text-neutral-700"><strong className="tabular-nums">{emailCount}</strong> emails</span>
        <span className="text-neutral-500">|</span>
        <span><strong className="tabular-nums text-emerald-700">{ackedToday}</strong> acked today</span>
      </div>

      <div className="mb-6 flex items-center gap-3 text-xs">
        <span className="text-neutral-500">Email filter:</span>
        {!showAll ? (
          <>
            <span className="rounded bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">business + unclassified</span>
            <Link href="/admin/queue?show=all" className="text-brand-700 hover:underline">show all (incl. personal / legal)</Link>
          </>
        ) : (
          <>
            <span className="rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-inset ring-amber-200">all classifications</span>
            <Link href="/admin/queue" className="text-brand-700 hover:underline">back to business-only</Link>
          </>
        )}
      </div>

      {sweepable.length > 0 && (
        <div className="mb-6">
          <BulkSweepButton disabled={false} eligibleCount={sweepable.length} />
          <p className="mt-1 text-[11px] text-neutral-500">
            Sweeps importance ≤ 6 calls/texts older than 7 days. Marks them <code>bulk_swept</code> with audit trail. Emails are not bulk-swept — each one gets a real triage decision.
          </p>
        </div>
      )}

      <Section title={`${high.length} high importance (≥ 7)`} description="Triage these first — reference point for what 'real follow-up' looks like.">
        {high.length === 0 ? (
          <EmptyState title="No high-importance items pending. 🎉" />
        ) : (
          <ul className="space-y-2">
            {high.map((r) => <QueueItem key={`${r.kind}-${r.id}`} row={r} />)}
          </ul>
        )}
      </Section>

      <div className="my-6" />

      <Section title={`${mid.length + low.length} medium / low importance`} description="The long tail. Bulk-sweep handles age >7d at importance ≤ 6 (calls/texts only); emails always need an explicit decision.">
        {mid.length + low.length === 0 ? (
          <EmptyState title="Queue empty." />
        ) : (
          <ul className="space-y-2">
            {[...mid, ...low].map((r) => <QueueItem key={`${r.kind}-${r.id}`} row={r} dim />)}
          </ul>
        )}
      </Section>
    </PageShell>
  );
}

function QueueItem({ row, dim }: { row: Row; dim?: boolean }) {
  const imp = importanceBadge(row.importance);
  const channelLabel = row.kind === "email" ? "email" : (row.channel || "—");

  // Header line varies slightly between events and emails.
  let topRow: React.ReactNode;
  if (row.kind === "email") {
    topRow = (
      <>
        <span className="font-medium text-neutral-900 truncate" title={row.from_address ?? ""}>
          {row.customer_name ?? row.from_address ?? "—"}
        </span>
        {row.from_address && row.customer_name && row.customer_name !== row.from_address && (
          <span className="text-[10px] text-neutral-500">{row.from_address}</span>
        )}
        {row.ai_intent && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200">{row.ai_intent}</span>}
        {row.ai_classification && row.ai_classification !== "business" && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">{row.ai_classification}</span>
        )}
      </>
    );
  } else {
    const customerHref = row.hcp_customer_id ? `/customer/${row.hcp_customer_id}` : null;
    topRow = (
      <>
        <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-neutral-500 ring-1 ring-inset ring-neutral-200">{row.direction ?? "—"}</span>
        {customerHref ? (
          <Link href={customerHref} className="font-medium text-neutral-900 hover:underline">{row.customer_name ?? "—"}</Link>
        ) : (
          <span className="font-medium text-neutral-900">{row.customer_name ?? "—"}</span>
        )}
        {row.tech_short_name && <span className="text-neutral-600">· {row.tech_short_name}</span>}
      </>
    );
  }

  const jobHref = row.kind === "event" && row.hcp_job_id ? `/job/${row.hcp_job_id}` : null;

  return (
    <li className={`overflow-hidden rounded-xl border bg-white shadow-sm ${dim ? "border-neutral-200 opacity-90" : "border-neutral-200"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ring-1 ring-inset ${imp.cls}`}>imp {imp.label}</span>
          <span className="rounded bg-white px-1.5 py-0.5 font-medium text-neutral-700 ring-1 ring-inset ring-neutral-200">{channelLabel}</span>
          {topRow}
          <span className="text-neutral-500" title={fmtAbs(row.occurred_at)}>{fmtAge(row.occurred_at)} ago</span>
          {flagBadges(row.flags)}
        </div>
        <div className="flex items-center gap-3">
          {jobHref && <Link href={jobHref} className="text-brand-700 hover:underline">job →</Link>}
        </div>
      </div>
      {row.kind === "email" && row.subject && (
        <div className="border-b border-neutral-100 px-4 py-2 text-sm font-medium text-neutral-800">
          {row.subject}
        </div>
      )}
      {row.summary && (
        <div className="border-b border-neutral-100 px-4 py-3 text-sm leading-relaxed text-neutral-800">
          <div className="whitespace-pre-wrap">{row.summary}</div>
        </div>
      )}
      <div className="px-4 py-2.5">
        <QueueItemActions id={row.id} kind={row.kind} />
      </div>
    </li>
  );
}
