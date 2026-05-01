// Per-job 360 view
import { db } from "@/lib/supabase";
import Link from "next/link";
import { NoteForm } from "../../../components/NoteForm";
import { addJobNote } from "../../../lib/notes-actions";
import { PageShell } from "../../../components/PageShell";
import { Section } from "../../../components/ui/Section";
import { StatCard } from "../../../components/ui/StatCard";
import { Pill } from "../../../components/ui/Pill";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LinkButton } from "../../../components/ui/Button";
import { TechName } from "../../../components/ui/TechName";
import { getCurrentTech } from "../../../lib/current-tech";
import { getFormerTechNames } from "../../../lib/former-techs";

export const dynamic = "force-dynamic";

type JobNote = {
  id: string;
  hcp_job_id: string;
  author_email: string;
  body: string;
  created_at: string;
};

function fmtMoney(n: unknown): string {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentTech().catch(() => null);
  const canWrite = !!me?.canWrite;
  const formerSet = await getFormerTechNames();
  const supabase = db();

  const { data: jobRow } = await supabase
    .from("job_360")
    .select("*")
    .eq("hcp_job_id", id)
    .maybeSingle();

  if (!jobRow) {
    return (
      <PageShell title="Job not found" backHref="/" backLabel="Today">
        <EmptyState
          title="No job_360 row for this id."
          description={
            <>
              Looked up <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">{id}</code> · It may have been archived or the id may be wrong.
            </>
          }
        />
      </PageShell>
    );
  }

  const j = jobRow as Record<string, unknown>;
  const customerId = j.hcp_customer_id as string | null;

  const [{ data: comms }, similarRes, notesRes] = await Promise.all([
    customerId
      ? supabase
          .from("communication_events")
          .select("id, occurred_at, channel, direction, importance, sentiment, flags, tech_short_name, summary")
          .eq("hcp_customer_id", customerId)
          .order("occurred_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supabase.rpc("job_similar_to", { target_id: id, n: 6 }),
    supabase
      .from("job_notes")
      .select("id, hcp_job_id, author_email, body, created_at")
      .eq("hcp_job_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const notes = (notesRes.data ?? []) as JobNote[];

  const addressLine = [j.street as string, j.city as string].filter(Boolean).join(", ");
  const description = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {addressLine ? <span>{addressLine}</span> : null}
      <span className="font-mono text-xs text-neutral-500">{id}</span>
      {customerId ? (
        <Link href={`/customer/${customerId}`} className="text-brand-700 hover:underline">
          customer 360 →
        </Link>
      ) : null}
    </span>
  );

  return (
    <PageShell
      kicker="Job"
      title={(j.customer_name as string) ?? id}
      description={description}
      backHref="/jobs"
      backLabel="All jobs"
      actions={
        canWrite ? (
          <LinkButton href={`/job/${id}/estimate/new`} variant="primary">
            + Multi-option estimate
          </LinkButton>
        ) : null
      }
    >
      <div className="space-y-10">
        <Section title="At a glance">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Date" value={(j.job_date as string) ?? "—"} />
            <StatCard label="Tech" value={<TechName name={j.tech_primary_name as string | null} formerSet={formerSet} />} />
            <StatCard label="Status" value={(j.appointment_status as string) ?? (j.status as string) ?? "—"} />
            <StatCard label="Crew size" value={(j.crew_size as number) ?? "—"} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Revenue" value={fmtMoney(j.revenue)} tone="brand" />
            <StatCard label="Materials" value={fmtMoney(j.materials_cost)} />
            <StatCard
              label="Gross margin"
              value={j.gross_margin_pct != null ? `${Number(j.gross_margin_pct).toFixed(0)}%` : "—"}
              tone={Number(j.gross_margin_pct) >= 50 ? "green" : Number(j.gross_margin_pct) < 30 ? "amber" : "neutral"}
            />
            <StatCard label="Receipts cost" value={fmtMoney(j.receipts_cost)} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="GPS matched" value={j.gps_matched ? "yes" : "no"} tone={j.gps_matched ? "green" : "neutral"} />
            <StatCard
              label="On time"
              value={j.on_time === true ? "yes" : j.on_time === false ? "late" : "—"}
              tone={j.on_time === false ? "amber" : j.on_time === true ? "green" : "neutral"}
            />
            <StatCard label="Min on site" value={(j.time_on_site_minutes as number) ?? "—"} />
            <StatCard label="Min early" value={(j.minutes_early as number) ?? "—"} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Comms (this job)" value={(j.comm_count_for_job as number) ?? 0} />
            <StatCard label="Comms 30d window" value={(j.comm_count_customer_30d_window as number) ?? 0} />
            <StatCard
              label="Open follow-ups (cust)"
              value={(j.open_followups_for_customer as number) ?? 0}
              tone={Number(j.open_followups_for_customer) > 0 ? "amber" : "neutral"}
            />
            <StatCard label="Photos" value={(j.photo_count as number) ?? 0} />
          </div>
        </Section>

        {Array.isArray(j.topics_in_window) && (j.topics_in_window as string[]).length > 0 && (
          <Section title="Topics in 14-day window">
            <div className="flex flex-wrap gap-1.5">
              {(j.topics_in_window as string[]).map((t) => (
                <Pill key={t} tone="slate">{t}</Pill>
              ))}
            </div>
          </Section>
        )}

        {Array.isArray(similarRes.data) && (similarRes.data as Array<Record<string, unknown>>).length > 0 && (() => {
          const rows = similarRes.data as Array<Record<string, unknown>>;
          const revenues = rows
            .map((r) => Number(r.revenue))
            .filter((v) => Number.isFinite(v) && v > 0);
          const avg = revenues.length > 0 ? revenues.reduce((a, b) => a + b, 0) / revenues.length : null;
          return (
            <Section
              title="Similar past jobs"
              description={
                avg !== null
                  ? `Avg revenue ${fmtMoney(avg)} across ${revenues.length} priced job${revenues.length === 1 ? "" : "s"}.`
                  : undefined
              }
            >
              <ul className="space-y-2">
                {rows.map((s) => (
                  <li key={s.hcp_job_id as string} className="rounded-2xl border border-neutral-200 bg-white p-3 transition hover:border-neutral-300 hover:shadow-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={`/job/${s.hcp_job_id}`} className="font-medium text-neutral-900 hover:underline">
                        {(s.customer_name as string) ?? "(no name)"}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                        <Pill tone="brand" mono>sim {Number(s.similarity).toFixed(2)}</Pill>
                        <span>{(s.job_date as string) ?? "no date"}</span>
                        <span>·</span>
                        <TechName name={s.tech_primary_name as string | null} formerSet={formerSet} />
                        <span>·</span>
                        <span className="font-medium text-neutral-700 tabular-nums">{fmtMoney(s.revenue)}</span>
                        {s.gross_margin_pct != null ? (
                          <>
                            <span>·</span>
                            <span>{Number(s.gross_margin_pct).toFixed(0)}% margin</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-1.5 max-w-3xl whitespace-pre-line text-xs italic text-neutral-600">
                      {((s.text_preview as string) ?? "").slice(0, 250)}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          );
        })()}

        <Section title="Operator notes">
          {canWrite ? (
            <div className="mb-3 rounded-2xl border border-neutral-200 bg-white p-4">
              <NoteForm
                action={addJobNote}
                hiddenFieldName="hcp_job_id"
                hiddenFieldValue={id}
                placeholder="Internal note about this job (not customer-facing)…"
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
            <EmptyState title="No notes yet." description="Add one above to keep context for the next visit." />
          )}
        </Section>

        <Section
          title="Recent communications for this customer"
          description="Calls, texts, and emails surrounding this appointment window."
        >
          {comms && comms.length > 0 ? (
            <ul className="space-y-2">
              {comms.map((m: Record<string, unknown>) => (
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
