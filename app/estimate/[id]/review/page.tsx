// AI-estimate REVIEW surface — the human-in-the-loop for the
// 'estimate-from-conversation' build-mode edge fn. The fn writes a DRAFT
// (bid_estimates status='draft' + bid_estimate_lines, each carrying a rich
// `intake` jsonb). A tech assigned to the job reviews the multi-option estimate
// here — reasoning, materials provenance, gap/reprice flags, block_push — BEFORE
// anything is pushed to HCP. Tech-facing; anyone assigned to the job (Danny
// audit-trail #2). DOLLARS throughout.

import Link from "next/link";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScrollPanel } from "@/components/ui/ScrollPanel";
import { getCurrentTech } from "@/lib/current-tech";
import { db } from "@/lib/supabase";
import { getReviewEstimate } from "./actions";
import { ReviewControls } from "./ReviewControls";
import {
  groupOptions,
  pricingCoverage,
  siteVisitRecommended,
  rankTone,
  money,
  materialsNeedQuote,
  materialsFromCatalog,
  lineGapFlags,
  lineRepriceFlags,
  lineIsBlocked,
  type ReviewLine,
  type ReviewOption,
} from "@/lib/estimate-review";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review AI estimate · TPAR-DB" };

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// Severity → pill tone for reprice flags. 'block' is red + unmissable.
function repriceTone(sev: string): "red" | "amber" | "slate" {
  if (sev === "block") return "red";
  if (sev === "warn") return "amber";
  return "slate";
}

function LineCard({ line }: { line: ReviewLine }) {
  const isFee = line.line_type === "fee" || line.intake?.is_fee_line === true;
  const needQuote = materialsNeedQuote(line);
  const fromCatalog = materialsFromCatalog(line);
  const blocked = lineIsBlocked(line);
  const gaps = lineGapFlags(line);
  const flags = lineRepriceFlags(line);
  const reasoning = line.intake?.reasoning ?? null;
  const hint = line.intake?.materials_hint_DOLLARS;
  const ref = line.intake?.materials_source_ref ?? null;

  return (
    <div className={`rounded-2xl border p-4 ${blocked ? "border-red-300 bg-red-50/40" : "border-neutral-200 bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-neutral-900">{line.item_name}</span>
            {isFee ? <Pill tone="slate">fee</Pill> : <Pill tone="slate">scope</Pill>}
            {line.intake?.is_custom ? <Pill tone="violet">custom</Pill> : null}
            <Pill tone={line.matched_from === "price_book" ? "green" : "neutral"} mono>
              {line.matched_from}
            </Pill>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-500">
            {line.labor_hours != null ? <span>{line.labor_hours} labor hr</span> : null}
            {line.materials_cost_internal != null && line.materials_cost_internal > 0 ? (
              <span>materials {money(line.materials_cost_internal)}</span>
            ) : null}
            {line.modifier_total != null && line.modifier_total !== 0 ? (
              <span>modifiers {money(line.modifier_total)}</span>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-base font-semibold tabular-nums text-neutral-900">{money(line.line_sell_price)}</div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-400">sell price</div>
        </div>
      </div>

      {/* Materials provenance — catalog ref (priced) vs. needs-distributor-quote (unpriced) */}
      <div className="mt-3">
        {fromCatalog ? (
          <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800">
            <span aria-hidden>📒</span>
            <span>catalog ref: <span className="font-mono">{ref ?? "—"}</span></span>
          </div>
        ) : needQuote ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <div className="flex items-center gap-1.5 font-semibold">
              <span aria-hidden>⚠️</span> Materials need a distributor quote
            </div>
            <p className="mt-1 text-amber-800">
              No catalog reference — get a distributor quote before pushing.
              {hint != null ? (
                <> AI rough guess: <span className="font-medium">{money(hint)}</span> <span className="italic">(not priced)</span>.</>
              ) : null}
            </p>
          </div>
        ) : (
          <div className="text-xs text-neutral-400">No materials provenance recorded.</div>
        )}
      </div>

      {/* Reprice / block flags — UNMISSABLE */}
      {flags.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {flags.map((f, i) => (
            <div
              key={`${f.code}-${i}`}
              className={`rounded-md border px-3 py-2 text-xs ${
                f.severity === "block"
                  ? "border-red-300 bg-red-50 text-red-900"
                  : f.severity === "warn"
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-neutral-200 bg-neutral-50 text-neutral-700"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={repriceTone(f.severity)}>{f.severity === "block" ? "BLOCK — do not push" : f.severity}</Pill>
                <span className="font-mono text-[10px] text-neutral-500">{f.code}</span>
              </div>
              <p className="mt-1">{f.message}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* AI reasoning — why this price */}
      {reasoning ? (
        <details className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-neutral-600 hover:text-neutral-900">
            Why this price (AI reasoning)
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-neutral-700">{reasoning}</p>
        </details>
      ) : null}

      {/* Open questions the AI flagged (gaps that could move the price) */}
      {gaps.length > 0 ? (
        <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
            Open questions ({gaps.length}) — confirm on site
          </div>
          <ul className="mt-1 space-y-1 text-xs text-indigo-900">
            {gaps.map((g, i) => (
              <li key={`${g.parameter}-${i}`} className="flex flex-wrap items-start gap-1.5">
                <span className="rounded bg-indigo-100 px-1 py-0.5 font-mono text-[10px] text-indigo-700">{g.parameter}</span>
                {g.price_impact ? (
                  <span className="rounded bg-white px-1 py-0.5 text-[10px] text-indigo-600 ring-1 ring-inset ring-indigo-200">
                    {g.price_impact} impact
                  </span>
                ) : null}
                <span className="min-w-0">{g.question_text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function OptionCard({ option }: { option: ReviewOption }) {
  return (
    <div className={`rounded-2xl border p-4 ${option.hasBlock ? "border-red-300" : "border-neutral-200"} bg-neutral-50/40`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">Option {option.label}</span>
          {option.rank ? <Pill tone={rankTone(option.rank)} size="md">{option.rank}</Pill> : null}
          <span className="text-sm font-semibold text-neutral-900">{option.name ?? `Option ${option.label}`}</span>
          {option.hasBlock ? <Pill tone="red">has a blocking flag</Pill> : null}
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums text-neutral-900">{money(option.subtotal)}</div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-400">option subtotal</div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 ring-1 ring-inset ring-emerald-200">
          {option.catalogCount} catalog-referenced
        </span>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800 ring-1 ring-inset ring-amber-200">
          {option.needsQuoteCount} need a quote
        </span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">
          {option.lines.length} line{option.lines.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="space-y-3">
        {option.lines.map((l) => (
          <LineCard key={l.id} line={l} />
        ))}
      </div>
    </div>
  );
}

export default async function EstimateReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentTech().catch(() => null);
  if (!me) redirect(`/login?from=/estimate/${id}/review`);

  const data = await getReviewEstimate(id);
  if (!data) {
    return (
      <PageShell title="Estimate not found" backHref="/estimates" backLabel="All estimates">
        <EmptyState
          title="Couldn't find that estimate."
          description={
            <>
              No estimate with id <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">{id}</code>.
            </>
          }
        />
      </PageShell>
    );
  }

  const { estimate, lines } = data;

  // Tech scope auth — mirror /job/[id] (#130, Danny 2026-05-04): a tech only
  // sees a draft for a job they were on. Admin/manager/production_manager bypass.
  // job_360.tech_primary_name + tech_all_names store FULL names.
  if (me.dashboardRole === "tech" && me.tech) {
    const techFullName = me.tech.hcp_full_name ?? me.tech.tech_short_name;
    let onJob = !estimate.hcp_job_id; // no job link → can't scope by assignment; allow (drafts on their customers).
    if (estimate.hcp_job_id) {
      const { data: jobRow } = await db()
        .from("job_360")
        .select("tech_primary_name, tech_all_names")
        .eq("hcp_job_id", estimate.hcp_job_id)
        .maybeSingle();
      const j = jobRow as { tech_primary_name?: string | null; tech_all_names?: string[] | null } | null;
      const onPrimary = j?.tech_primary_name === techFullName;
      const onCrew = Array.isArray(j?.tech_all_names) && j!.tech_all_names!.includes(techFullName);
      onJob = onPrimary || onCrew;
    }
    if (!onJob) {
      return (
        <PageShell kicker="AI estimate" title="Outside your scope" backHref="/" backLabel="Today">
          <EmptyState
            title="You weren't on this job."
            description="For privacy + system safety, techs only review estimates for jobs they were on. If you should have access, text Danny the job number and he'll add you."
          />
        </PageShell>
      );
    }
  }

  const options = groupOptions(lines);
  const coverage = pricingCoverage(lines);
  const siteVisit = siteVisitRecommended(lines);
  const anyBlock = options.some((o) => o.hasBlock);
  const canWrite = !!me.canWrite;
  const alreadyReviewed = estimate.status === "ready" || !!estimate.tech_authorized_at;

  // The work_description holds the full multi-option write-up (Summary / Work
  // Description / Notes). scope_text is the raw conversation-derived scope.

  return (
    <PageShell
      kicker="AI estimate · review"
      title={estimate.project_name || estimate.customer_name || "AI estimate"}
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {estimate.customer_name ? <span>{estimate.customer_name}</span> : null}
          <span className="font-mono text-xs text-neutral-500">{estimate.id}</span>
          {estimate.hcp_job_id ? (
            <Link href={`/job/${estimate.hcp_job_id}`} className="font-mono text-xs text-brand-700 hover:underline">
              job →
            </Link>
          ) : null}
        </span>
      }
      backHref="/estimates"
      backLabel="All estimates"
      actions={
        <Link
          href={`/estimate/${estimate.id}`}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Estimate record →
        </Link>
      }
      help={{
        intent:
          "Review the AI-built estimate before it goes to HCP. Each option shows what the AI proposed, why it priced it that way, and where the materials numbers came from. Nothing is sent to the customer or HCP until you (or Danny) push it — a separate step.",
        actions: [
          "Read the options top to bottom — they're ordered good → better → best.",
          "Red BLOCK flags mean a price/scope needs a human decision before it can be pushed.",
          "Amber 'needs a distributor quote' means the materials number is an AI guess, not priced — get a real quote.",
          "Indigo open-questions are things to confirm on site (they could move the price).",
          "When it looks right, pick the option and Approve — that sends it to HousecallPro as a customer estimate.",
        ],
      }}
    >
      <div className="space-y-8">
        {/* Top status strip */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-4">
          <Pill tone={estimate.status === "ready" ? "green" : "neutral"} size="md">{estimate.status ?? "draft"}</Pill>
          <Pill tone="brand">AI-built</Pill>
          <span className="text-xs text-neutral-500">{options.length} option{options.length === 1 ? "" : "s"}</span>
          <span className="text-neutral-300">·</span>
          <span className="text-xs text-neutral-500">built by {estimate.created_by ?? "—"}</span>
          <span className="text-neutral-300">·</span>
          <span className="text-xs text-neutral-500">{fmtDate(estimate.created_at)}</span>
          {estimate.subtotal != null ? (
            <span className="ml-auto text-sm">
              <span className="text-neutral-500">primary option </span>
              <span className="font-semibold text-neutral-900">{money(estimate.subtotal)}</span>
            </span>
          ) : null}
        </div>

        {/* Unmissable banner if anything blocks the push */}
        {anyBlock ? (
          <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-900">
              <span aria-hidden>⛔</span> This estimate has a blocking flag
            </div>
            <p className="mt-1 text-sm text-red-800">
              At least one line is marked do-not-push, or its recomputed price is outside the historical band. Review the
              flagged line(s) below. Approving requires explicitly acknowledging the block.
            </p>
          </div>
        ) : null}

        {/* Pricing-coverage rollup */}
        <Section title="Pricing coverage" description="How much of this estimate is priced from the catalog vs. still needs a real distributor quote.">
          <div className="flex flex-wrap gap-3">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="text-2xl font-semibold tabular-nums text-emerald-800">{coverage.catalog}</div>
              <div className="text-xs text-emerald-700">catalog-referenced</div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="text-2xl font-semibold tabular-nums text-amber-800">{coverage.needQuote}</div>
              <div className="text-xs text-amber-700">need a distributor quote</div>
            </div>
            <div className={`rounded-2xl border px-4 py-3 ${coverage.blocked > 0 ? "border-red-200 bg-red-50" : "border-neutral-200 bg-white"}`}>
              <div className={`text-2xl font-semibold tabular-nums ${coverage.blocked > 0 ? "text-red-700" : "text-neutral-400"}`}>{coverage.blocked}</div>
              <div className={`text-xs ${coverage.blocked > 0 ? "text-red-700" : "text-neutral-500"}`}>blocking flag{coverage.blocked === 1 ? "" : "s"}</div>
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3">
              <div className="text-2xl font-semibold tabular-nums text-neutral-900">{coverage.total}</div>
              <div className="text-xs text-neutral-500">total lines</div>
            </div>
          </div>
          {siteVisit ? (
            <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
              <span aria-hidden>📍</span> Site visit recommended before finalizing — the AI flagged access/site conditions it couldn&apos;t confirm.
            </div>
          ) : null}
        </Section>

        {/* Scope summary + work description (the customer-facing write-up) */}
        {estimate.scope_text ? (
          <Section title="Scope" description="What the conversation/intake said this job is.">
            <div className="rounded-2xl border border-neutral-200 bg-white p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">{estimate.scope_text}</p>
            </div>
          </Section>
        ) : null}

        {estimate.work_description ? (
          <Section title="Work description" description="The customer-facing write-up the AI drafted (Summary / Work Description / Notes).">
            <div className="rounded-2xl border border-neutral-200 bg-white p-4">
              <ScrollPanel tier="primary">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">{estimate.work_description}</p>
              </ScrollPanel>
            </div>
          </Section>
        ) : null}

        {/* Options */}
        <Section title="Options" description="Ordered good → better → best. Pick one when you approve.">
          {options.length === 0 ? (
            <EmptyState title="No option lines on this draft." description="The build-mode function didn't write any line items for this estimate." />
          ) : (
            <div className="space-y-4">
              {options.map((o) => (
                <OptionCard key={o.label} option={o} />
              ))}
            </div>
          )}
        </Section>

        {/* Approve — records the review + sends the estimate to HCP (2026-07-21). */}
        <Section
          title="Approve & send"
          description="Records that a human reviewed this AI draft and which option you're approving, then sends it to HousecallPro as a customer estimate."
        >
          <ReviewControls
            id={estimate.id}
            options={options.map((o) => ({ label: o.label, name: o.name, rank: o.rank }))}
            hasBlock={anyBlock}
            canWrite={canWrite}
            alreadyReviewed={alreadyReviewed}
          />
          {estimate.tech_authorized_at ? (
            <p className="mt-2 text-xs text-neutral-500">
              Reviewed {fmtDate(estimate.tech_authorized_at)}
              {estimate.tech_authorized_option_id ? ` · option ${estimate.tech_authorized_option_id}` : ""}
              {estimate.tech_authorization_note ? ` · ${estimate.tech_authorization_note}` : ""}
            </p>
          ) : null}
        </Section>
      </div>
    </PageShell>
  );
}
