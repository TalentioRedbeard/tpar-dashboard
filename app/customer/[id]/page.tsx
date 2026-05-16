// Per-customer 360 view
import { db } from "@/lib/supabase";
import Link from "next/link";
import { NoteForm } from "../../../components/NoteForm";
import { addCustomerNote } from "../../../lib/notes-actions";
import { AgreementForm } from "../../../components/AgreementForm";
import { AgreementStatusButton } from "../../../components/AgreementStatusButton";
import { TechName } from "../../../components/ui/TechName";
import { getCurrentTech } from "../../../lib/current-tech";
import { getFormerTechNames } from "../../../lib/former-techs";
import { PageShell } from "../../../components/PageShell";
import { Section } from "../../../components/ui/Section";
import { StatCard } from "../../../components/ui/StatCard";
import { Pill } from "../../../components/ui/Pill";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LinkButton } from "../../../components/ui/Button";
import { ProvenanceCard, type ProvenanceItem } from "../../../components/ui/ProvenanceCard";
import { getCurrentMembership } from "../../membership/actions";

export const dynamic = "force-dynamic";

type CustomerNote = {
  id: string;
  hcp_customer_id: string;
  author_email: string;
  body: string;
  created_at: string;
};

function fmtMoney(n: unknown): string {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentTech().catch(() => null);
  const canWrite = !!me?.canWrite;
  const formerSet = await getFormerTechNames();
  const supabase = db();

  // Tech scope auth: techs only see customers they've worked for (#130).
  // Admin/manager/production_manager bypass.
  // Note: job_360.tech_primary_name + tech_all_names store FULL names
  // (e.g., "Omar Fernandez"), not the short name.
  if (me && me.dashboardRole === "tech" && me.tech) {
    const techFullName = me.tech.hcp_full_name ?? me.tech.tech_short_name;
    const { data: scope } = await supabase
      .from("job_360")
      .select("hcp_job_id")
      .eq("hcp_customer_id", id)
      .or(`tech_primary_name.eq.${techFullName},tech_all_names.cs.{${techFullName}}`)
      .limit(1);
    if (!scope || scope.length === 0) {
      return (
        <PageShell kicker="Customer" title="Outside your scope" backHref="/" backLabel="Today">
          <EmptyState
            title="You haven't worked for this customer."
            description={
              <>
                For privacy + system safety, techs only see customers they've worked for.
                If you need access, ask the production manager.
              </>
            }
          />
        </PageShell>
      );
    }
  }

  const [c, recentComms, recentJobs, repeatRow, recurringJobsRow, similarRes, notesRes, agreementsRes, currentMembership, hcpJobNotesRes, hcpEstimateNotesRes, provCustRes, provCardRes, provJobsRes, provCommsRes] = await Promise.all([
    supabase.from("customer_360").select("*").eq("hcp_customer_id", id).maybeSingle(),
    supabase
      .from("communication_events")
      .select("id, occurred_at, channel, direction, importance, sentiment, flags, tech_short_name, summary")
      .eq("hcp_customer_id", id)
      .order("occurred_at", { ascending: false })
      .limit(30),
    supabase
      .from("job_360")
      .select("hcp_job_id, customer_name, tech_primary_name, job_date, revenue, gross_margin_pct, gps_matched, time_on_site_minutes, on_time, due_amount, days_outstanding")
      .eq("hcp_customer_id", id)
      .order("job_date", { ascending: false, nullsFirst: false })
      .limit(20),
    supabase.from("customer_repeat_jobs_v").select("*").eq("hcp_customer_id", id).maybeSingle(),
    supabase.from("customer_recurring_jobs_v").select("*").eq("hcp_customer_id", id).maybeSingle(),
    supabase.rpc("customer_similar_to", { target_id: id, n: 6 }),
    supabase
      .from("customer_notes")
      .select("id, hcp_customer_id, author_email, body, created_at")
      .eq("hcp_customer_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("maintenance_agreements_v")
      .select("*")
      .eq("hcp_customer_id", id)
      .order("status", { ascending: true })
      .order("starts_on", { ascending: false }),
    getCurrentMembership(id),
    // HCP-mirrored notes (data comes in via hcp-webhook on job.* events).
    // Surfaced here because the data is in the DB but no page renders it.
    supabase
      .from("hcp_jobs_raw")
      .select("hcp_job_id, scheduled_start, hcp_notes")
      .eq("hcp_customer_id", id)
      .not("hcp_notes", "is", null)
      .neq("hcp_notes", "")
      .order("scheduled_start", { ascending: false, nullsFirst: false })
      .limit(30),
    supabase
      .from("hcp_estimates_raw")
      .select("hcp_estimate_id, scheduled_start, last_synced_at, hcp_notes")
      .eq("hcp_customer_id", id)
      .not("hcp_notes", "is", null)
      .neq("hcp_notes", "")
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(30),
    // Provenance probes — small queries that surface "where did this come from?"
    supabase.from("hcp_customers_raw").select("last_synced_at").eq("hcp_customer_id", id).maybeSingle(),
    supabase.from("customer_cards_current_v1").select("updated_at").eq("hcp_customer_id", id).maybeSingle(),
    supabase.from("hcp_jobs_raw").select("last_synced_at", { count: "exact", head: false }).eq("hcp_customer_id", id).order("last_synced_at", { ascending: false, nullsFirst: false }).limit(1),
    supabase.from("communication_events").select("occurred_at", { count: "exact", head: false }).eq("hcp_customer_id", id).order("occurred_at", { ascending: false, nullsFirst: false }).limit(1),
  ]);

  // Assemble provenance items for the bottom-of-page ProvenanceCard.
  const userNoteLatest = (notesRes.data ?? [])[0] as { created_at?: string } | undefined;
  const provenanceItems: ProvenanceItem[] = [
    {
      section: "Customer record",
      source_fn: "hcp-webhook",
      tables: ["hcp_customers_raw", "customers_master"],
      last_ts: (provCustRes.data as { last_synced_at?: string } | null)?.last_synced_at ?? null,
      count: provCustRes.data ? 1 : 0,
      note: provCustRes.data ? undefined : "no raw row",
    },
    {
      section: "Customer card (AI summary)",
      source_fn: "build-customer-card",
      tables: ["customer_cards_current_v1"],
      last_ts: (provCardRes.data as { updated_at?: string } | null)?.updated_at ?? null,
      count: provCardRes.data ? 1 : 0,
      note: provCardRes.data ? undefined : "card never built — run build-customer-card",
    },
    {
      section: "Recent jobs + invoices",
      source_fn: "hcp-webhook",
      tables: ["hcp_jobs_raw", "hcp_invoices_raw", "job_360"],
      last_ts: (provJobsRes.data?.[0] as { last_synced_at?: string } | undefined)?.last_synced_at ?? null,
      count: provJobsRes.count ?? (provJobsRes.data?.length ?? 0),
    },
    {
      section: "Communications timeline",
      source_fn: "hcp-webhook + transcribe-and-store-call + store-text-message + pull-gmail",
      tables: ["communication_events", "text_messages", "call_transcripts", "emails_received"],
      last_ts: (provCommsRes.data?.[0] as { occurred_at?: string } | undefined)?.occurred_at ?? null,
      count: provCommsRes.count ?? (provCommsRes.data?.length ?? 0),
    },
    {
      section: "HCP-mirrored notes",
      source_fn: "hcp-webhook",
      tables: ["hcp_jobs_raw.hcp_notes", "hcp_estimates_raw.hcp_notes"],
      last_ts: null,
      count: ((hcpJobNotesRes.data ?? []).length + (hcpEstimateNotesRes.data ?? []).length),
    },
    {
      section: "User-authored customer notes",
      source_fn: "dashboard",
      tables: ["customer_notes"],
      last_ts: userNoteLatest?.created_at ?? null,
      count: (notesRes.data ?? []).length,
    },
  ];
  const notes = (notesRes.data ?? []) as CustomerNote[];
  const agreements = (agreementsRes.data ?? []) as Array<{
    id: number;
    scope_text: string;
    cadence_days: number | null;
    base_price: string | number | null;
    starts_on: string;
    ends_on: string | null;
    status: string;
    origin_pattern: string | null;
    next_visit_eta: string | null;
    author_email: string;
    created_at: string;
  }>;
  const hasRecurringSignal = !!recurringJobsRow.data || !!repeatRow.data;
  const defaultOrigin: "recurring_jobs" | "repeat_jobs" | "manual" =
    recurringJobsRow.data ? "recurring_jobs" : repeatRow.data ? "repeat_jobs" : "manual";

  function buildPrefilledScope(): string {
    if (agreements.length > 0 && agreements.some((a) => a.status === "active")) return "";
    const r = recurringJobsRow.data as Record<string, unknown> | null;
    const p = repeatRow.data as Record<string, unknown> | null;
    if (r) {
      const pairs = r.recurring_job_pairs as number;
      const earliest = r.earliest_job as string | null;
      const latest = r.most_recent_job as string | null;
      const sample = (r.sample_job_a as string | null)?.split("\n").find((l) => l.trim().length > 20)?.trim() ?? null;
      const span = earliest && latest ? `${earliest} → ${latest}` : "";
      return [
        `Preventative service — recurring pattern detected: ${pairs} similar jobs ${span}.`,
        sample ? `Representative scope: ${sample.slice(0, 200)}` : "",
        `Replace recurring emergency-rate visits with scheduled cadence.`,
      ].filter(Boolean).join("\n");
    }
    if (p) {
      const count = p.job_count_12mo as number;
      const span = p.span_days as number | null;
      return [
        `Preventative service — ${count} jobs in last 12 months${span ? ` (span ${span}d)` : ""}.`,
        `Convert repeat-call cadence into a scheduled-service agreement.`,
      ].filter(Boolean).join("\n");
    }
    return "";
  }
  const prefilledScope = buildPrefilledScope();

  if (!c.data) {
    return (
      <PageShell title="Customer not found" backHref="/" backLabel="Today">
        <EmptyState
          title="No customer_360 row for this id."
          description={
            <>
              Looked up <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">{id}</code>.
            </>
          }
        />
      </PageShell>
    );
  }

  const cust = c.data as Record<string, unknown>;

  return (
    <PageShell
      kicker="Customer"
      title={(cust.name as string) ?? id}
      description={
        <span className="font-mono text-xs text-neutral-500">{id}</span>
      }
      backHref="/customers"
      backLabel="All customers"
    >
      <div className="space-y-10">
        <Section title="Membership">
          {currentMembership && currentMembership.status === "active" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
              <div>
                <div className="font-semibold text-emerald-900">{currentMembership.customer_facing_name}</div>
                <div className="mt-0.5 text-xs text-emerald-800">
                  {currentMembership.bill_discount_pct}% off all service work · member since {new Date(currentMembership.started_at).toLocaleDateString()}
                  {currentMembership.current_period_end ? <> · renews {new Date(currentMembership.current_period_end).toLocaleDateString()}</> : null}
                </div>
                {currentMembership.enrolled_by_tech ? (
                  <div className="mt-0.5 text-xs text-emerald-700">enrolled by {currentMembership.enrolled_by_tech}</div>
                ) : null}
              </div>
              <Pill tone="green">active</Pill>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4">
              <div>
                <div className="font-medium text-neutral-700">Not a member yet</div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  Offering membership at the next service can be a "no-brainer" for the customer (10–20% off the bill, depending on tier).
                </div>
              </div>
              {canWrite ? (
                <LinkButton href={`/membership/enroll?customer=${id}`} variant="primary">
                  + Enroll
                </LinkButton>
              ) : null}
            </div>
          )}
        </Section>

        <Section title="Lifetime + signal">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Lifetime jobs" value={(cust.lifetime_job_count as number) ?? 0} />
            <StatCard label="Paid LTD" value={fmtMoney(cust.lifetime_paid_revenue_dollars)} tone="brand" />
            <StatCard
              label="Outstanding"
              value={Number(cust.outstanding_due_dollars) > 0 ? fmtMoney(cust.outstanding_due_dollars) : "—"}
              tone={Number(cust.outstanding_due_dollars) > 0 ? "red" : "neutral"}
            />
            <StatCard
              label="Open follow-ups"
              value={(cust.open_followups as number) ?? 0}
              tone={Number(cust.open_followups) > 0 ? "amber" : "neutral"}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Comms 90d" value={(cust.comm_count_90d as number) ?? 0} />
            <StatCard label="Lifetime comms" value={(cust.lifetime_comm_count as number) ?? 0} />
            <StatCard
              label="Negative 90d"
              value={(cust.negative_comms_90d as number) ?? 0}
              tone={Number(cust.negative_comms_90d) > 0 ? "red" : "neutral"}
            />
            <StatCard
              label="Positive 90d"
              value={(cust.positive_comms_90d as number) ?? 0}
              tone={Number(cust.positive_comms_90d) > 0 ? "green" : "neutral"}
            />
          </div>
        </Section>

        {Array.isArray(cust.topic_set) && (cust.topic_set as string[]).length > 0 && (
          <Section title="Topics seen">
            <div className="flex flex-wrap gap-1.5">
              {(cust.topic_set as string[]).map((t) => (
                <Pill key={t} tone="slate">{t}</Pill>
              ))}
            </div>
          </Section>
        )}

        {!!cust.ai_summary && (
          <Section title="AI summary">
            <div className="rounded-2xl border border-neutral-200 bg-white p-5">
              <p className="text-sm leading-relaxed text-neutral-800">{cust.ai_summary as string}</p>
            </div>
          </Section>
        )}

        {(repeatRow.data || recurringJobsRow.data) && (
          <section>
            <div className="rounded-2xl border border-accent-100 bg-accent-50 p-5">
              <div className="mb-2 flex items-center gap-2">
                <Pill tone="amber">Pattern signal</Pill>
                <span className="text-sm font-semibold text-accent-700">Preventative-agreement candidate</span>
              </div>
              <ul className="space-y-1 text-sm text-accent-700/90">
                {repeatRow.data && (() => {
                  const r = repeatRow.data as Record<string, unknown>;
                  return (
                    <li>
                      <strong>{r.job_count_12mo as number}</strong> jobs in {r.span_days as number}d
                      {" · avg "}
                      <strong>{r.avg_days_between as number}d</strong> between visits
                      {" · "}
                      {fmtMoney(r.total_revenue_12mo)} revenue last 12mo
                      {(r.preventative_candidate as boolean) && (
                        <span className="ml-2"><Pill tone="amber" size="sm">flagged</Pill></span>
                      )}
                    </li>
                  );
                })()}
                {recurringJobsRow.data && (() => {
                  const r = recurringJobsRow.data as Record<string, unknown>;
                  return (
                    <li>
                      <strong>{r.recurring_job_pairs as number}</strong> same-kind job pair{(r.recurring_job_pairs as number) === 1 ? "" : "s"}
                      {" · max similarity "}
                      <strong>{Number(r.max_similarity).toFixed(2)}</strong>
                      {" · "}
                      spans {r.earliest_job as string} → {r.most_recent_job as string}
                    </li>
                  );
                })()}
              </ul>
            </div>
          </section>
        )}

        {Array.isArray(similarRes.data) && (similarRes.data as Array<Record<string, unknown>>).length > 0 && (
          <Section
            title="Similar customers"
            description="Cosine similarity over richer 2026-04-30 embeddings."
          >
            <ul className="space-y-2">
              {(similarRes.data as Array<Record<string, unknown>>).map((s) => {
                const overlap = (s.topic_overlap as string[] | null) ?? [];
                return (
                  <li key={s.hcp_customer_id as string} className="rounded-2xl border border-neutral-200 bg-white p-3 transition hover:border-neutral-300 hover:shadow-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={`/customer/${s.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">
                        {s.customer_name as string}
                      </Link>
                      <div className="flex items-center gap-2 text-xs text-neutral-500">
                        <Pill tone="brand" mono>sim {Number(s.similarity).toFixed(2)}</Pill>
                        <span>comms 90d: {(s.comm_count_90d as number) ?? 0}</span>
                        {Number(s.outstanding_due_dollars) > 0 ? (
                          <span className="text-red-700">· {fmtMoney(s.outstanding_due_dollars)} due</span>
                        ) : null}
                      </div>
                    </div>
                    {overlap.length > 0 && (
                      <div className="mt-1 text-xs text-neutral-500">shared topics: {overlap.join(", ")}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        <Section
          id="agreement"
          title="Maintenance agreements"
          description="Decision capture today; auto-scheduling in v1."
        >
          {agreements.length > 0 ? (
            <ul className="mb-3 space-y-2">
              {agreements.map((a) => (
                <li key={a.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-900">
                      <Pill
                        tone={
                          a.status === "active" ? "green"
                            : a.status === "paused" ? "amber"
                            : "neutral"
                        }
                      >
                        {a.status}
                      </Pill>
                      <span>{a.cadence_days ? `every ${a.cadence_days}d` : "no cadence"}</span>
                      {a.base_price != null ? (
                        <span className="text-neutral-600">· ${Number(a.base_price).toLocaleString()}/visit</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-neutral-500">
                      {a.next_visit_eta ? `next ETA ${a.next_visit_eta}` : "—"}
                      <span className="mx-1">·</span>
                      started {a.starts_on}
                      {a.origin_pattern && a.origin_pattern !== "manual" ? ` · from ${a.origin_pattern}` : ""}
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">{a.scope_text}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
                    <span>by {a.author_email}</span>
                    {canWrite ? (
                      <AgreementStatusButton agreementId={a.id} currentStatus={a.status} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-neutral-500">
              No agreements yet
              {hasRecurringSignal ? " — but this customer shows recurring patterns; consider one." : "."}
            </p>
          )}
          {canWrite ? (
            <AgreementForm
              hcpCustomerId={id}
              defaultOrigin={defaultOrigin}
              prefilledScope={prefilledScope}
            />
          ) : (
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">
              Manager view — read-only. New agreements can be created by Danny or a tech.
            </div>
          )}
        </Section>

        <Section title="Operator notes">
          {canWrite ? (
            <div className="mb-3 rounded-2xl border border-neutral-200 bg-white p-4">
              <NoteForm
                action={addCustomerNote}
                hiddenFieldName="hcp_customer_id"
                hiddenFieldValue={id}
                placeholder="Internal note about this customer (not customer-facing)…"
                label="Add note"
              />
            </div>
          ) : (
            <div className="mb-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">
              Manager view — read-only. Notes can be added by Danny or a tech.
            </div>
          )}
          {notes.length > 0 ? (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                  <div className="mb-1 text-xs text-neutral-500">
                    {new Date(n.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                    <span className="mx-1.5">·</span>
                    {n.author_email}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-neutral-800">{n.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No notes yet." description="Add one above to keep context across visits." />
          )}
        </Section>

        <Section title="Recent jobs">
          {recentJobs.data && recentJobs.data.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">Date</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">Tech</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Revenue</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Margin</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">GPS</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">On-time</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Min</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Days out</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {recentJobs.data.map((j: Record<string, unknown>) => (
                    <tr key={j.hcp_job_id as string} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 whitespace-nowrap text-neutral-700">
                        <Link href={`/job/${j.hcp_job_id}`} className="hover:underline">{(j.job_date as string) ?? "—"}</Link>
                      </td>
                      <td className="px-4 py-2 text-neutral-700"><TechName name={j.tech_primary_name as string | null} formerSet={formerSet} /></td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{fmtMoney(j.revenue)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{j.gross_margin_pct != null ? `${Number(j.gross_margin_pct).toFixed(0)}%` : "—"}</td>
                      <td className="px-4 py-2">{j.gps_matched ? <Pill tone="green">yes</Pill> : <Pill tone="slate">no</Pill>}</td>
                      <td className="px-4 py-2">{j.on_time === true ? <Pill tone="green">on</Pill> : j.on_time === false ? <Pill tone="amber">late</Pill> : <Pill>—</Pill>}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{(j.time_on_site_minutes as number) ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {Number(j.due_amount) > 0 ? <span className="text-red-700">{j.days_outstanding as number}d</span> : <span className="text-neutral-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No jobs." />
          )}
        </Section>

        <Section title="HCP notes (from job + estimate webhooks)">
          {(() => {
            type HcpNoteRow = { kind: "job" | "estimate"; id: string; ts: string | null; body: string };
            const jobRows: HcpNoteRow[] = (hcpJobNotesRes.data ?? []).map((j: Record<string, unknown>) => ({
              kind: "job" as const,
              id: j.hcp_job_id as string,
              ts: (j.scheduled_start as string | null) ?? null,
              body: String(j.hcp_notes ?? "").trim(),
            }));
            const estRows: HcpNoteRow[] = (hcpEstimateNotesRes.data ?? []).map((e: Record<string, unknown>) => ({
              kind: "estimate" as const,
              id: e.hcp_estimate_id as string,
              ts: (e.scheduled_start as string | null) ?? (e.last_synced_at as string | null) ?? null,
              body: String(e.hcp_notes ?? "").trim(),
            }));
            const merged = [...jobRows, ...estRows]
              .filter((r) => r.body.length > 0)
              .sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
            if (merged.length === 0) {
              return <EmptyState title="No HCP notes." description="Notes added on jobs or estimates in HCP land here via webhook." />;
            }
            return (
              <ul className="space-y-2">
                {merged.map((r) => (
                  <li key={`${r.kind}-${r.id}`} className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                      <Pill tone={r.kind === "job" ? "slate" : "amber"}>{r.kind}</Pill>
                      {r.ts ? (
                        <span className="font-mono">
                          {new Date(r.ts).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short" })}
                        </span>
                      ) : null}
                      {r.kind === "job" ? (
                        <Link href={`/job/${r.id}`} className="ml-auto text-neutral-500 hover:text-neutral-700 hover:underline">open job →</Link>
                      ) : (
                        <span className="ml-auto font-mono text-neutral-400">{r.id.slice(0, 12)}…</span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-neutral-800">{r.body}</p>
                  </li>
                ))}
              </ul>
            );
          })()}
        </Section>

        <ProvenanceCard items={provenanceItems} />

        <Section title="Recent communications">
          {recentComms.data && recentComms.data.length > 0 ? (
            <ul className="space-y-2">
              {recentComms.data.map((m: Record<string, unknown>) => (
                <li key={m.id as number} className="rounded-2xl border border-neutral-200 bg-white p-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    <span className="font-mono">
                      {new Date(m.occurred_at as string).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                    </span>
                    <Pill tone="slate">{m.channel as string}</Pill>
                    {m.direction ? <Pill tone="slate">{m.direction as string}</Pill> : null}
                    {m.tech_short_name ? <span>· {m.tech_short_name as string}</span> : null}
                    <span className="ml-auto">imp {(m.importance as number) ?? "—"}</span>
                  </div>
                  <p className="text-sm text-neutral-800">{m.summary as string}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No communications." />
          )}
        </Section>
      </div>
    </PageShell>
  );
}
