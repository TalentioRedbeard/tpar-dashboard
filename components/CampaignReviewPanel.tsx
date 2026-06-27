"use client";

// Campaign-draft review panel — vet AI-personalized campaign messages before
// they send. Generic over campaign_key so future campaigns reuse it.
//
// Drafts are GROUPED BY assigned_tech (the tech who worked the job = the
// reviewer). 'Unassigned' is Madisson's / the office pile. HOLD drafts are
// internal notes, surfaced in red and NOT presentable as approvable-to-send.
//
// Each card owns its own subject/body edit buffer (local state) so typing only
// re-renders that card, not all ~300. Status commits bubble up to the panel via
// onStatusChange so the running counts + per-group counts stay live.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pill, type Tone } from "./ui/Pill";
import { EmptyState } from "./ui/EmptyState";
import {
  approveDraft,
  rejectDraft,
  saveDraftEdit,
  type CampaignDraft,
  type ReviewStatus,
  type SegmentType,
} from "@/lib/campaign-review-actions";

export type CampaignOption = { campaign_key: string; total: number };

const SEGMENT_TONE: Record<SegmentType, Tone> = {
  homeowner: "green",
  landlord: "violet",
  hold: "red",
};

const STATUS_TONE: Record<ReviewStatus, Tone> = {
  pending_review: "amber",
  approved: "green",
  edited: "brand",
  rejected: "slate",
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending_review: "Pending review",
  approved: "Approved",
  edited: "Edited",
  rejected: "Rejected",
};

function originalTechOf(basis: Record<string, unknown> | null): string | null {
  if (!basis || typeof basis !== "object") return null;
  const v = (basis as Record<string, unknown>).original_tech;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ── A single draft ───────────────────────────────────────────────────────────
function DraftCard({
  draft,
  onStatusChange,
}: {
  draft: CampaignDraft;
  onStatusChange: (id: string, status: ReviewStatus) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<ReviewStatus>(draft.review_status);
  const [subject, setSubject] = useState(draft.final_subject ?? draft.draft_subject ?? "");
  const [body, setBody] = useState(draft.final_body ?? draft.draft_body ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const isHold = draft.segment_type === "hold";
  const origTech = originalTechOf(draft.basis);
  const dirty =
    subject !== (draft.final_subject ?? draft.draft_subject ?? "") ||
    body !== (draft.final_body ?? draft.draft_body ?? "");

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, nextStatus: ReviewStatus, flash: string) {
    setErr(null);
    setSavedFlash(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setStatus(nextStatus);
        onStatusChange(draft.id, nextStatus);
        setSavedFlash(flash);
        router.refresh();
      } else {
        setErr(r.error);
      }
    });
  }

  const segTone = SEGMENT_TONE[(draft.segment_type ?? "homeowner") as SegmentType];

  return (
    <div
      className={`rounded-xl border bg-white p-3.5 shadow-sm ${
        isHold ? "border-red-300 border-l-[3px] border-l-red-500" : "border-neutral-200"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-neutral-900">{draft.customer_name ?? "(no name)"}</span>
        {draft.segment_type ? (
          <Pill tone={segTone}>{isHold ? "⛔ HOLD" : draft.segment_type.toUpperCase()}</Pill>
        ) : null}
        {draft.signal ? <Pill tone="neutral">{draft.signal}</Pill> : null}
        <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
        {draft.normalized_email ? (
          <span className="text-xs text-neutral-500">{draft.normalized_email}</span>
        ) : (
          <span className="text-xs text-red-600">no email</span>
        )}
      </div>

      {origTech ? (
        <p className="mb-2 text-[11px] italic text-neutral-500">originally: {origTech} (left company)</p>
      ) : null}

      {isHold ? (
        // HOLD = internal note. Show the reason; never present it as sendable.
        <div className="rounded-md bg-red-50 px-3 py-2 text-xs leading-snug text-red-900">
          <span className="font-semibold">Internal hold — do not send. </span>
          {draft.draft_body || draft.draft_subject || "Flagged to hold."}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Subject</span>
            <input
              type="text"
              value={subject}
              disabled={pending}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Body</span>
            <textarea
              value={body}
              disabled={pending}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-sm leading-snug"
            />
          </label>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {isHold ? (
          <button
            type="button"
            disabled={pending || status === "rejected"}
            onClick={() => run(() => rejectDraft(draft.id), "rejected", "Marked handled")}
            className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Mark handled
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={pending || status === "approved"}
              onClick={() => run(() => approveDraft(draft.id), "approved", "Approved ✓")}
              className="rounded-md border border-emerald-400 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              ✓ Approve
            </button>
            <button
              type="button"
              disabled={pending || !dirty}
              onClick={() => run(() => saveDraftEdit(draft.id, subject, body), "edited", "Saved edit ✓")}
              className="rounded-md border border-sky-400 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
            >
              {dirty ? "Save edit" : "Saved"}
            </button>
            <button
              type="button"
              disabled={pending || status === "rejected"}
              onClick={() => run(() => rejectDraft(draft.id), "rejected", "Rejected")}
              className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
            >
              Reject
            </button>
          </>
        )}
        {pending ? <span className="text-[11px] text-neutral-400">working…</span> : null}
        {savedFlash && !pending ? <span className="text-[11px] text-emerald-700">{savedFlash}</span> : null}
        {err ? <span className="text-[11px] text-red-700">{err}</span> : null}
      </div>
    </div>
  );
}

// ── A tech's group ───────────────────────────────────────────────────────────
function TechGroup({
  techName,
  drafts,
  statuses,
  onStatusChange,
}: {
  techName: string;
  drafts: CampaignDraft[];
  statuses: Record<string, ReviewStatus>;
  onStatusChange: (id: string, status: ReviewStatus) => void;
}) {
  const isUnassigned = techName === "Unassigned";
  const counts = drafts.reduce(
    (acc, d) => {
      const s = statuses[d.id] ?? d.review_status;
      acc[s] = (acc[s] ?? 0) + 1;
      if (d.segment_type === "hold") acc.holds += 1;
      return acc;
    },
    { pending_review: 0, approved: 0, edited: 0, rejected: 0, holds: 0 } as Record<string, number>,
  );

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-neutral-200 pb-1.5">
        <h3 className="text-sm font-semibold text-neutral-900">
          {isUnassigned ? "Unassigned" : techName}
        </h3>
        {isUnassigned ? (
          <span className="text-[11px] text-neutral-500">Madisson / office pile</span>
        ) : null}
        <span className="text-[11px] text-neutral-400">{drafts.length} drafts</span>
        {counts.pending_review > 0 ? <Pill tone="amber">{counts.pending_review} pending</Pill> : null}
        {counts.approved > 0 ? <Pill tone="green">{counts.approved} approved</Pill> : null}
        {counts.edited > 0 ? <Pill tone="brand">{counts.edited} edited</Pill> : null}
        {counts.rejected > 0 ? <Pill tone="slate">{counts.rejected} rejected</Pill> : null}
        {counts.holds > 0 ? <Pill tone="red">{counts.holds} hold</Pill> : null}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {drafts.map((d) => (
          <DraftCard key={d.id} draft={d} onStatusChange={onStatusChange} />
        ))}
      </div>
    </section>
  );
}

// ── The panel ────────────────────────────────────────────────────────────────
export function CampaignReviewPanel({
  campaignKey,
  campaigns,
  drafts,
}: {
  campaignKey: string;
  campaigns: CampaignOption[];
  drafts: CampaignDraft[];
}) {
  const router = useRouter();

  // Lifted status map (only) drives the live counts. Card edit buffers stay local.
  const [statuses, setStatuses] = useState<Record<string, ReviewStatus>>(() =>
    Object.fromEntries(drafts.map((d) => [d.id, d.review_status])),
  );
  const onStatusChange = (id: string, status: ReviewStatus) =>
    setStatuses((prev) => ({ ...prev, [id]: status }));

  // Group drafts by assigned_tech. 'Unassigned' (office pile) sorts to the top,
  // then the rest by descending draft count.
  const groups = useMemo(() => {
    const map = new Map<string, CampaignDraft[]>();
    for (const d of drafts) {
      const k = d.assigned_tech?.trim() || "Unassigned";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(d);
    }
    const entries = [...map.entries()];
    entries.sort((a, b) => {
      if (a[0] === "Unassigned") return -1;
      if (b[0] === "Unassigned") return 1;
      return b[1].length - a[1].length;
    });
    return entries;
  }, [drafts]);

  const totals = useMemo(() => {
    const t = { pending_review: 0, approved: 0, edited: 0, rejected: 0 };
    for (const d of drafts) {
      const s = statuses[d.id] ?? d.review_status;
      if (s in t) t[s as keyof typeof t] += 1;
    }
    return t;
  }, [drafts, statuses]);

  const reviewed = totals.approved + totals.edited + totals.rejected;

  return (
    <div>
      {/* Campaign chooser + running totals */}
      <div className="mb-5 rounded-2xl border-2 border-neutral-400 border-t-[4px] border-t-navy-700 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Campaign</span>
          {campaigns.map((c) => {
            const active = c.campaign_key === campaignKey;
            return (
              <button
                key={c.campaign_key}
                type="button"
                onClick={() => router.push(`/campaigns/review?campaign=${encodeURIComponent(c.campaign_key)}`)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                  active
                    ? "border-brand-700 bg-brand-50 text-brand-800"
                    : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {c.campaign_key}
                <span className="ml-1 text-neutral-400">({c.total})</span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <Pill tone="amber" size="md">{totals.pending_review} pending</Pill>
          <span className="text-neutral-400">·</span>
          <Pill tone="green" size="md">{totals.approved} approved</Pill>
          <Pill tone="brand" size="md">{totals.edited} edited</Pill>
          <Pill tone="slate" size="md">{totals.rejected} rejected</Pill>
          <span className="ml-1 text-neutral-500">
            {reviewed} of {drafts.length} reviewed
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-neutral-500">
          Vet each message before it sends. <b>Approve</b> marks it ready; edit the subject/body and{" "}
          <b>Save edit</b> to use your wording; <b>Reject</b> drops it. Approving does not send anything yet —
          that is a later step. <span className="text-red-700 font-medium">HOLD</span> rows are internal notes
          (active accounts, open jobs) — not sendable; mark them handled.
        </p>
      </div>

      {groups.length === 0 ? (
        <EmptyState title="No drafts for this campaign" description="Nothing has been generated under this campaign key yet." />
      ) : (
        groups.map(([techName, techDrafts]) => (
          <TechGroup
            key={techName}
            techName={techName}
            drafts={techDrafts}
            statuses={statuses}
            onStatusChange={onStatusChange}
          />
        ))
      )}
    </div>
  );
}
