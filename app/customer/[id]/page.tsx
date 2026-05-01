// Per-customer 360 view
import { db } from "@/lib/supabase";
import Link from "next/link";
import { NoteForm } from "../../../components/NoteForm";
import { addCustomerNote } from "../../../lib/notes-actions";
import { AgreementForm } from "../../../components/AgreementForm";
import { AgreementStatusButton } from "../../../components/AgreementStatusButton";

export const dynamic = "force-dynamic";

type CustomerNote = {
  id: string;
  hcp_customer_id: string;
  author_email: string;
  body: string;
  created_at: string;
};

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = db();

  const [c, recentComms, recentJobs, repeatRow, recurringJobsRow, similarRes, notesRes, agreementsRes] = await Promise.all([
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
  ]);
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

  // Pre-fill the agreement scope when the customer shows a recurring signal
  // and they don't already have an active agreement. This converts pattern
  // detection into actionable suggestion at the form-fill layer.
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
      <main className="mx-auto max-w-4xl p-6">
        <Link href="/" className="text-sm text-zinc-500 hover:underline">← Today</Link>
        <h1 className="text-2xl font-bold mt-3">Customer not found</h1>
        <p className="text-sm text-zinc-500 mt-2">No customer_360 row for <code className="px-1 py-0.5 bg-zinc-100 rounded">{id}</code></p>
      </main>
    );
  }

  const cust = c.data as Record<string, unknown>;
  return (
    <main className="mx-auto max-w-5xl p-6 space-y-8">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">← Today</Link>
        <h1 className="text-3xl font-bold mt-2">{cust.name as string ?? id}</h1>
        <p className="text-sm text-zinc-500 mt-1 font-mono">{id}</p>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Lifetime jobs" value={cust.lifetime_job_count as number} />
        <Stat label="Paid LTD" value={`$${Number(cust.lifetime_paid_revenue_dollars).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        <Stat label="Outstanding" value={Number(cust.outstanding_due_dollars) > 0 ? `$${Number(cust.outstanding_due_dollars).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"} tone={Number(cust.outstanding_due_dollars) > 0 ? "red" : "neutral"} />
        <Stat label="Open follow-ups" value={cust.open_followups as number} tone={Number(cust.open_followups) > 0 ? "amber" : "neutral"} />
        <Stat label="Comms 90d" value={cust.comm_count_90d as number} />
        <Stat label="Lifetime comms" value={cust.lifetime_comm_count as number} />
        <Stat label="Negative 90d" value={cust.negative_comms_90d as number} tone={Number(cust.negative_comms_90d) > 0 ? "red" : "neutral"} />
        <Stat label="Positive 90d" value={cust.positive_comms_90d as number} tone={Number(cust.positive_comms_90d) > 0 ? "green" : "neutral"} />
      </section>

      {Array.isArray(cust.topic_set) && cust.topic_set.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 mb-2">Topics seen</h2>
          <div className="flex flex-wrap gap-1">
            {(cust.topic_set as string[]).map((t) => (
              <span key={t} className="inline-flex px-2 py-0.5 rounded-full text-xs bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200">{t}</span>
            ))}
          </div>
        </section>
      )}

      {!!cust.ai_summary && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 mb-2">AI summary (existing customer card)</h2>
          <p className="text-sm leading-relaxed">{cust.ai_summary as string}</p>
        </section>
      )}

      {(repeatRow.data || recurringJobsRow.data) && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900 mb-2">Pattern signal — preventative-agreement candidate</h2>
          <ul className="space-y-1 text-sm text-amber-900">
            {repeatRow.data && (() => {
              const r = repeatRow.data as Record<string, unknown>;
              return (
                <li>
                  <strong>{r.job_count_12mo as number}</strong> jobs in {r.span_days as number}d
                  {" · avg "}
                  <strong>{r.avg_days_between as number}d</strong> between visits
                  {" · "}
                  ${Number(r.total_revenue_12mo).toLocaleString(undefined, { maximumFractionDigits: 0 })} revenue last 12mo
                  {(r.preventative_candidate as boolean) && <span className="ml-2 inline-flex px-2 py-0.5 rounded bg-amber-200 text-amber-900 text-xs font-medium">flagged</span>}
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
        </section>
      )}

      {Array.isArray(similarRes.data) && (similarRes.data as Array<Record<string, unknown>>).length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 mb-2">Similar customers (cosine on richer 2026-04-30 embeddings)</h2>
          <ul className="space-y-1">
            {(similarRes.data as Array<Record<string, unknown>>).map((s) => {
              const overlap = (s.topic_overlap as string[] | null) ?? [];
              return (
                <li key={s.hcp_customer_id as string} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">
                  <Link href={`/customer/${s.hcp_customer_id}`} className="font-medium hover:underline">
                    {s.customer_name as string}
                  </Link>
                  <span className="ml-2 text-xs text-zinc-500">
                    sim {Number(s.similarity).toFixed(2)}
                    {" · "}
                    comms 90d: {(s.comm_count_90d as number) ?? 0}
                    {Number(s.outstanding_due_dollars) > 0 && (
                      <span className="ml-1 text-red-700">· ${Number(s.outstanding_due_dollars).toLocaleString(undefined, { maximumFractionDigits: 0 })} due</span>
                    )}
                  </span>
                  {overlap.length > 0 && (
                    <div className="text-xs text-zinc-500 mt-0.5">shared topics: {overlap.join(", ")}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section id="agreement" className="scroll-mt-20">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Maintenance agreements</h2>
          <span className="text-xs text-zinc-500">v0 — decision capture · execution coming in v1</span>
        </div>
        {agreements.length > 0 ? (
          <ul className="mb-3 space-y-2">
            {agreements.map((a) => (
              <li key={a.id} className="rounded border border-zinc-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-medium text-zinc-900">
                    <span
                      className={`mr-2 rounded-full px-2 py-0.5 text-xs ${
                        a.status === "active"
                          ? "bg-emerald-50 text-emerald-800"
                          : a.status === "paused"
                          ? "bg-amber-50 text-amber-800"
                          : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {a.status}
                    </span>
                    {a.cadence_days ? `every ${a.cadence_days}d` : "no cadence"}
                    {a.base_price != null ? ` · $${Number(a.base_price).toLocaleString()}/visit` : ""}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {a.next_visit_eta ? `next ETA ${a.next_visit_eta}` : "—"}
                    {" · "}
                    started {a.starts_on}
                    {a.origin_pattern && a.origin_pattern !== "manual" ? ` · from ${a.origin_pattern}` : ""}
                  </div>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">{a.scope_text}</p>
                <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
                  <span>by {a.author_email}</span>
                  <AgreementStatusButton agreementId={a.id} currentStatus={a.status} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-zinc-500">
            No agreements yet
            {hasRecurringSignal ? " — but this customer shows recurring patterns; consider one." : "."}
          </p>
        )}
        <AgreementForm
          hcpCustomerId={id}
          defaultOrigin={defaultOrigin}
          prefilledScope={prefilledScope}
        />
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Operator notes</h2>
        <div className="rounded border border-zinc-200 bg-white p-3 mb-3">
          <NoteForm
            action={addCustomerNote}
            hiddenFieldName="hcp_customer_id"
            hiddenFieldValue={id}
            placeholder="Internal note about this customer (not customer-facing)…"
            label="Add note"
          />
        </div>
        {notes.length > 0 ? (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded border border-zinc-200 bg-white p-3">
                <div className="text-xs text-zinc-500 mb-1">
                  {new Date(n.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                  {" · "}{n.author_email}
                </div>
                <p className="text-sm whitespace-pre-wrap">{n.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">No notes yet.</p>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Recent jobs</h2>
        {recentJobs.data && recentJobs.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-zinc-500 border-b">
                <tr>
                  <th className="py-2">Date</th>
                  <th className="py-2">Tech</th>
                  <th className="py-2 text-right">Revenue</th>
                  <th className="py-2 text-right">Margin</th>
                  <th className="py-2">GPS</th>
                  <th className="py-2">On-time</th>
                  <th className="py-2 text-right">Min</th>
                  <th className="py-2 text-right">Days out</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.data.map((j: Record<string, unknown>) => (
                  <tr key={j.hcp_job_id as string} className="border-b last:border-0 hover:bg-zinc-50">
                    <td className="py-2 whitespace-nowrap">{(j.job_date as string) ?? "—"}</td>
                    <td className="py-2">{(j.tech_primary_name as string) ?? "—"}</td>
                    <td className="py-2 text-right">{j.revenue != null ? `$${Number(j.revenue).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}</td>
                    <td className="py-2 text-right">{j.gross_margin_pct != null ? `${Number(j.gross_margin_pct).toFixed(0)}%` : "—"}</td>
                    <td className="py-2">{j.gps_matched ? "✓" : "—"}</td>
                    <td className="py-2">{j.on_time === true ? "✓" : j.on_time === false ? "late" : "—"}</td>
                    <td className="py-2 text-right">{j.time_on_site_minutes as number ?? "—"}</td>
                    <td className="py-2 text-right">{Number(j.due_amount) > 0 ? <span className="text-red-700">{j.days_outstanding as number}d</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-zinc-500">No jobs.</p>}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Recent communications</h2>
        {recentComms.data && recentComms.data.length > 0 ? (
          <ul className="space-y-2">
            {recentComms.data.map((m: Record<string, unknown>) => (
              <li key={m.id as number} className="rounded border border-zinc-200 p-3">
                <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                  <span className="font-mono">{new Date(m.occurred_at as string).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}</span>
                  <span>·</span>
                  <span>{m.channel as string}</span>
                  {!!m.direction && <><span>·</span><span>{m.direction as string}</span></>}
                  {!!m.tech_short_name && <><span>·</span><span>{m.tech_short_name as string}</span></>}
                  <span className="ml-auto">imp {m.importance as number ?? "—"}</span>
                </div>
                <p className="text-sm">{m.summary as string}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-zinc-500">No communications.</p>}
      </section>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "red" | "amber" | "green" | "neutral" }) {
  const cls =
    tone === "red"   ? "text-red-700" :
    tone === "amber" ? "text-amber-700" :
    tone === "green" ? "text-green-700" :
                       "text-zinc-900";
  return (
    <div className="rounded border border-zinc-200 p-3 bg-white">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
