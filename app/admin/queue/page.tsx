// /admin/queue — Email Phase 0 triage surface.
//
// Renders the communication_events follow-up backlog (importance ≥5, last
// 14 days, unacked, flagged needs_followup/unresolved/escalation_needed).
// Per-item actions write acked_at + acked_by + acked_disposition for audit.
//
// Pre-condition Danny named for opening email ingest: "clear the current
// follow-up queue, then start using the app myself." This is the surface
// that lets him do that.

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

type Row = {
  id: string;
  occurred_at: string;
  channel: string | null;
  direction: string | null;
  customer_name: string | null;
  tech_short_name: string | null;
  hcp_job_id: string | null;
  hcp_customer_id: string | null;
  importance: number | null;
  flags: string[] | null;
  summary: string | null;
};

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

function importanceBadge(imp: number | null): { cls: string; label: string } {
  const i = imp ?? 0;
  if (i >= 8) return { cls: "bg-red-50 text-red-700 ring-red-200", label: `${i}` };
  if (i >= 7) return { cls: "bg-amber-50 text-amber-800 ring-amber-200", label: `${i}` };
  if (i >= 6) return { cls: "bg-yellow-50 text-yellow-800 ring-yellow-200", label: `${i}` };
  return { cls: "bg-neutral-50 text-neutral-700 ring-neutral-200", label: `${i}` };
}

function flagBadges(flags: string[] | null): React.ReactNode {
  if (!flags || flags.length === 0) return null;
  const interesting = flags.filter((f) => ["needs_followup", "unresolved", "escalation_needed", "new_lead", "paid_acquisition"].includes(f));
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

export default async function QueuePage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");

  const supa = db();
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();

  const { data: rows } = await supa
    .from("communication_events")
    .select("id, occurred_at, channel, direction, customer_name, tech_short_name, hcp_job_id, hcp_customer_id, importance, flags, summary")
    .gte("occurred_at", since)
    .gte("importance", 5)
    .is("acked_at", null)
    .overlaps("flags", ["needs_followup", "unresolved", "escalation_needed"])
    .order("importance", { ascending: false, nullsFirst: false })
    .order("occurred_at", { ascending: false })
    .limit(200);

  const queue = (rows ?? []) as Row[];

  // Counts per importance band, plus low-importance-old eligibility for sweep.
  const high = queue.filter((r) => (r.importance ?? 0) >= 7);
  const mid  = queue.filter((r) => (r.importance ?? 0) === 6);
  const low  = queue.filter((r) => (r.importance ?? 0) === 5);
  const sweepable = queue.filter((r) => (r.importance ?? 0) <= 6 && (Date.now() - new Date(r.occurred_at).getTime()) > 7 * 86400_000);

  // Today's ack count for the header.
  const startOfDayUtc = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").toISOString();
  const { count: ackedToday } = await supa
    .from("communication_events")
    .select("id", { count: "exact", head: true })
    .gte("acked_at", startOfDayUtc);

  return (
    <PageShell
      kicker="Admin"
      title="Follow-up queue"
      description={
        <>
          Phase 0: clear the existing follow-up backlog so the queue is a live signal, not a graveyard. Per-item: <em>Done</em> = worked it · <em>Handled</em> = handled elsewhere · <em>Dismiss</em> = classifier noise.
        </>
      }
      backHref="/admin"
      backLabel="Admin home"
    >
      <div className="mb-6 flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm">
        <span><strong className="tabular-nums">{queue.length}</strong> open</span>
        <span className="text-neutral-500">|</span>
        <span><strong className="tabular-nums text-red-700">{high.length}</strong> importance ≥ 7</span>
        <span><strong className="tabular-nums text-yellow-700">{mid.length}</strong> imp 6</span>
        <span><strong className="tabular-nums text-neutral-600">{low.length}</strong> imp 5</span>
        <span className="text-neutral-500">|</span>
        <span><strong className="tabular-nums text-emerald-700">{ackedToday ?? 0}</strong> acked today</span>
      </div>

      {sweepable.length > 0 && (
        <div className="mb-6">
          <BulkSweepButton disabled={false} eligibleCount={sweepable.length} />
          <p className="mt-1 text-[11px] text-neutral-500">
            Sweeps importance ≤ 6 items older than 7 days. They mark as <code>bulk_swept</code> with audit trail.
          </p>
        </div>
      )}

      <Section title={`${high.length} high importance (≥ 7)`} description="Triage these first — they're the reference point for what 'real follow-up' looks like.">
        {high.length === 0 ? (
          <EmptyState title="No high-importance items pending. 🎉" />
        ) : (
          <ul className="space-y-2">
            {high.map((r) => <QueueItem key={r.id} row={r} />)}
          </ul>
        )}
      </Section>

      <div className="my-6" />

      <Section title={`${mid.length + low.length} medium / low importance`} description="The long tail. Bulk-sweep handles age >7d at importance ≤ 6; the rest stay below until you triage or sweep.">
        {mid.length + low.length === 0 ? (
          <EmptyState title="Queue empty." />
        ) : (
          <ul className="space-y-2">
            {[...mid, ...low].map((r) => <QueueItem key={r.id} row={r} dim />)}
          </ul>
        )}
      </Section>
    </PageShell>
  );
}

function QueueItem({ row, dim }: { row: Row; dim?: boolean }) {
  const imp = importanceBadge(row.importance);
  const customerHref = row.hcp_customer_id ? `/customer/${row.hcp_customer_id}` : null;
  const jobHref = row.hcp_job_id ? `/job/${row.hcp_job_id}` : null;

  return (
    <li className={`overflow-hidden rounded-xl border bg-white shadow-sm ${dim ? "border-neutral-200 opacity-90" : "border-neutral-200"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ring-1 ring-inset ${imp.cls}`}>imp {imp.label}</span>
          <span className="rounded bg-white px-1.5 py-0.5 font-medium text-neutral-700 ring-1 ring-inset ring-neutral-200">{row.channel ?? "—"}</span>
          <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-neutral-500 ring-1 ring-inset ring-neutral-200">{row.direction ?? "—"}</span>
          {customerHref ? (
            <Link href={customerHref} className="font-medium text-neutral-900 hover:underline">{row.customer_name ?? "—"}</Link>
          ) : (
            <span className="font-medium text-neutral-900">{row.customer_name ?? "—"}</span>
          )}
          {row.tech_short_name && <span className="text-neutral-600">· {row.tech_short_name}</span>}
          <span className="text-neutral-500" title={fmtAbs(row.occurred_at)}>{fmtAge(row.occurred_at)} ago</span>
          {flagBadges(row.flags)}
        </div>
        <div className="flex items-center gap-3">
          {jobHref && <Link href={jobHref} className="text-brand-700 hover:underline">job →</Link>}
        </div>
      </div>
      {row.summary && (
        <div className="border-b border-neutral-100 px-4 py-3 text-sm leading-relaxed text-neutral-800">
          <div className="whitespace-pre-wrap">{row.summary}</div>
        </div>
      )}
      <div className="px-4 py-2.5">
        <QueueItemActions id={row.id} />
      </div>
    </li>
  );
}
