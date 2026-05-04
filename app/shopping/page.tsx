// /shopping — procurement system v0 dashboard surface (#127)
// List open needs + a form to log new ones. Per-tech attribution comes from
// the signed-in user. Slack /need writes here too.

import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/EmptyState";
import { getOpenNeeds, getRecentlyCompletedNeeds, getResearchForNeed, type NeedRow, type Urgency, type ResearchResult } from "./actions";
import { LogNeedForm } from "./LogNeedForm";
import { NeedActions } from "./NeedActions";
import { ResearchButton } from "./ResearchButton";

export const dynamic = "force-dynamic";

const URGENCY_LABEL: Record<Urgency, string> = {
  asap:       "ASAP",
  today:      "today",
  this_week:  "this week",
  this_month: "this month",
  no_rush:    "no rush",
};

const URGENCY_TONE: Record<Urgency, "red" | "amber" | "brand" | "slate" | "neutral"> = {
  asap:       "red",
  today:      "amber",
  this_week:  "brand",
  this_month: "slate",
  no_rush:    "neutral",
};

const URGENCY_RANK: Record<Urgency, number> = {
  asap: 1, today: 2, this_week: 3, this_month: 4, no_rush: 5,
};

function fmtRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function NeedCard({ need, canWrite, research }: { need: NeedRow; canWrite: boolean; research: ResearchResult[] }) {
  const urg = need.urgency as Urgency;
  return (
    <li className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <Pill tone={URGENCY_TONE[urg]}>{URGENCY_LABEL[urg]}</Pill>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-neutral-900">
            {need.qty ? <span className="font-mono text-sm text-neutral-500 mr-1.5">{need.qty}×</span> : null}
            {need.item_description}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span>{need.submitted_by}</span>
            <span>·</span>
            <span>via {need.submitted_via}</span>
            <span>·</span>
            <span>{fmtRel(need.created_at)}</span>
            {need.hcp_job_id ? (
              <>
                <span>·</span>
                <a href={`/job/${need.hcp_job_id}`} className="text-brand-700 hover:underline font-mono">
                  {need.hcp_job_id.slice(0, 12)}…
                </a>
              </>
            ) : null}
            {need.location_label ? (
              <>
                <span>·</span>
                <span>{need.location_label}</span>
              </>
            ) : null}
          </div>
          {need.notes ? (
            <div className="mt-2 text-sm text-neutral-700 whitespace-pre-line">{need.notes}</div>
          ) : null}
          {canWrite ? (
            <ResearchButton needId={need.id} initialResults={research} />
          ) : null}
        </div>
        {canWrite ? <NeedActions needId={need.id} /> : null}
      </div>
    </li>
  );
}

export default async function ShoppingPage({
  searchParams,
}: {
  searchParams: Promise<{ prefill_job?: string }>;
}) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/shopping");

  const params = await searchParams;
  const prefillJob = params?.prefill_job ?? "";

  const [open, recentDone] = await Promise.all([
    getOpenNeeds({ limit: 100 }),
    getRecentlyCompletedNeeds(10),
  ]);

  // Load any existing research results for the open needs (parallel)
  const researchByNeedId = new Map<string, ResearchResult[]>();
  await Promise.all(open.map(async (n) => {
    const r = await getResearchForNeed(n.id);
    researchByNeedId.set(n.id, r);
  }));

  // Sort open by urgency rank then by created_at
  const sortedOpen = [...open].sort((a, b) => {
    const r = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (r !== 0) return r;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const byUrgency = (urg: Urgency) => sortedOpen.filter((n) => n.urgency === urg);

  return (
    <PageShell
      kicker="Procurement"
      title="Shopping list"
      description={
        <span>
          Log a need; the system researches, consolidates, and presents purchase decisions on a cadence per urgency.
          Also captureable from Slack with <code>/need</code>.
        </span>
      }
    >
      <Section title="Log a new need">
        <LogNeedForm canWrite={me.canWrite} defaultJobId={prefillJob} />
      </Section>

      <div className="my-6" />

      <Section
        title="Open needs"
        description={`${sortedOpen.length} item${sortedOpen.length === 1 ? "" : "s"} waiting · sorted by urgency`}
      >
        {sortedOpen.length === 0 ? (
          <EmptyState title="No open needs." description="Log one above to get started." />
        ) : (
          <div className="space-y-6">
            {(["asap", "today", "this_week", "this_month", "no_rush"] as Urgency[]).map((urg) => {
              const items = byUrgency(urg);
              if (items.length === 0) return null;
              return (
                <div key={urg}>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {URGENCY_LABEL[urg]} ({items.length})
                  </div>
                  <ul className="space-y-2">
                    {items.map((n) => <NeedCard key={n.id} need={n} canWrite={me.canWrite} research={researchByNeedId.get(n.id) ?? []} />)}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {recentDone.length > 0 && (
        <>
          <div className="my-6" />
          <Section title="Recently closed" description="Last 10 fulfilled or cancelled.">
            <ul className="space-y-2 opacity-70">
              {recentDone.map((n) => (
                <li key={n.id} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={n.status === "fulfilled" ? "green" : "neutral"}>{n.status}</Pill>
                    <span className="line-through">{n.item_description}</span>
                    <span className="text-xs text-neutral-500">· {n.submitted_by} · {fmtRel(n.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </PageShell>
  );
}
