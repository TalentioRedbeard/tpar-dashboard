// Search page — find customers, jobs, communications by name / phone / id / topic
import { db } from "@/lib/supabase";
import Link from "next/link";
import { PageShell } from "../../components/PageShell";
import { Section } from "../../components/ui/Section";
import { Pill } from "../../components/ui/Pill";
import { EmptyState } from "../../components/ui/EmptyState";

export const dynamic = "force-dynamic";

type SearchProps = {
  searchParams: Promise<{ q?: string }>;
};

async function loadResults(q: string) {
  if (!q) return { customers: [], jobs: [], comms: [], semantic: null };
  const supabase = db();
  const phone = q.replace(/\D/g, "").slice(-10);
  const isPhone = phone.length === 10;
  const isCustId = q.startsWith("cus_");
  const isJobId = q.startsWith("job_");
  const isInvoice = /^\d{6,}/.test(q);

  let custQ = supabase
    .from("customer_360")
    .select("hcp_customer_id, name, phone_mobile10, phone10, lifetime_job_count, open_followups, lifetime_paid_revenue_dollars, outstanding_due_dollars, comm_count_90d")
    .limit(15);
  if (isCustId) custQ = custQ.eq("hcp_customer_id", q);
  else if (isPhone) custQ = custQ.or(`phone10.eq.${phone},phone_mobile10.eq.${phone}`);
  else custQ = custQ.ilike("name", `%${q}%`);

  let jobQ = supabase
    .from("job_360")
    .select("hcp_job_id, customer_name, tech_primary_name, job_date, revenue, gross_margin_pct, gps_matched, time_on_site_minutes, on_time, invoice_number")
    .order("job_date", { ascending: false, nullsFirst: false })
    .limit(15);
  if (isJobId) jobQ = jobQ.eq("hcp_job_id", q);
  else if (isInvoice) jobQ = jobQ.or(`invoice_number.eq.${q},invoice_number.ilike.${q}-%`);
  else jobQ = jobQ.ilike("customer_name", `%${q}%`);

  const commsQ = supabase
    .from("communication_events")
    .select("id, occurred_at, channel, direction, customer_name, hcp_customer_id, tech_short_name, importance, sentiment, summary")
    .or(`customer_name.ilike.%${q}%,counterparty.ilike.%${q}%,summary.ilike.%${q}%`)
    .order("occurred_at", { ascending: false })
    .limit(20);

  const semanticQ = (isCustId || isJobId || isPhone || isInvoice)
    ? Promise.resolve(null)
    : runSemanticSearch(q);

  const [c, j, m, semantic] = await Promise.all([custQ, jobQ, commsQ, semanticQ]);
  return {
    customers: c.data ?? [],
    jobs: j.data ?? [],
    comms: m.data ?? [],
    semantic,
    error: c.error?.message ?? j.error?.message ?? m.error?.message,
  };
}

async function runSemanticSearch(q: string): Promise<SemanticResult | null> {
  const url = process.env.SEMANTIC_SEARCH_URL;
  const secret = process.env.SEMANTIC_SEARCH_SECRET;
  if (!url || !secret) return null;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Trigger-Secret": secret },
      body: JSON.stringify({ query: q, limit: 5, min_similarity: 0.5 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = await r.json() as { ok?: boolean; results?: SemanticResult["results"] };
    if (!j.ok) return null;
    return { query: q, results: j.results ?? {} };
  } catch {
    return null;
  }
}

type SemanticResult = {
  query: string;
  results: {
    communication_event?: Array<Record<string, unknown>>;
    customer?: Array<Record<string, unknown>>;
    job?: Array<Record<string, unknown>>;
  };
};

function fmtMoney(n: unknown): string {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
}

export default async function SearchPage({ searchParams }: SearchProps) {
  const { q = "" } = await searchParams;
  const results = q ? await loadResults(q) : null;

  return (
    <PageShell
      title="Search"
      description="Find customers, jobs, and communications by name, phone, id, invoice, or topic."
      backHref="/"
      backLabel="Today"
    >
      <form className="mb-6 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Customer name, phone, hcp_customer_id, hcp_job_id, invoice number, or content keyword"
          className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          autoFocus
        />
        <button type="submit" className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">
          Search
        </button>
      </form>

      {!q && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 text-sm text-neutral-700">
          <p className="mb-2 font-medium text-neutral-900">Try one of these forms:</p>
          <ul className="space-y-1.5 text-neutral-600">
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">Petrovich</code> — by customer name</li>
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">9182371234</code> — by phone (10 digits)</li>
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">27665535</code> — by invoice number</li>
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">cus_18d1eb20…</code> — by HCP customer id</li>
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">leak</code> — by topic in summaries</li>
          </ul>
        </div>
      )}

      {results?.error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          DB error: {results.error}
        </div>
      )}

      {results && (
        <div className="space-y-8">
          <Section title={`Customers (${results.customers.length})`}>
            {results.customers.length > 0 ? (
              <ul className="space-y-2">
                {results.customers.map((c: Record<string, unknown>) => (
                  <li key={c.hcp_customer_id as string} className="rounded-2xl border border-neutral-200 bg-white p-3 transition hover:border-neutral-300 hover:shadow-sm">
                    <Link href={`/customer/${c.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">
                      {(c.name as string) ?? (c.hcp_customer_id as string)}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
                      <span>{(c.lifetime_job_count as number) ?? 0} jobs</span>
                      <span>·</span>
                      <span>{fmtMoney(c.lifetime_paid_revenue_dollars)} paid</span>
                      <span>·</span>
                      <span>{(c.open_followups as number) ?? 0} open follow-ups</span>
                      <span>·</span>
                      <span>{(c.comm_count_90d as number) ?? 0} comms 90d</span>
                      {Number(c.outstanding_due_dollars) > 0 ? (
                        <span className="text-red-700">· {fmtMoney(c.outstanding_due_dollars)} outstanding</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No customer matches." variant="outlined" />}
          </Section>

          <Section title={`Jobs (${results.jobs.length})`}>
            {results.jobs.length > 0 ? (
              <ul className="space-y-2">
                {results.jobs.map((j: Record<string, unknown>) => (
                  <li key={j.hcp_job_id as string} className="rounded-2xl border border-neutral-200 bg-white p-3 transition hover:border-neutral-300 hover:shadow-sm">
                    <Link href={`/job/${j.hcp_job_id}`} className="font-medium text-neutral-900 hover:underline">
                      {(j.customer_name as string) ?? "(no name)"}
                      {j.invoice_number ? <span className="ml-2 font-mono text-xs text-neutral-500">#{j.invoice_number as string}</span> : null}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
                      <span>{(j.job_date as string) ?? "no date"}</span>
                      <span>·</span>
                      <span>{(j.tech_primary_name as string) ?? "—"}</span>
                      {j.revenue != null ? (<><span>·</span><span>{fmtMoney(j.revenue)}</span></>) : null}
                      {j.gross_margin_pct != null ? (<><span>·</span><span>{Number(j.gross_margin_pct).toFixed(0)}% margin</span></>) : null}
                      {j.gps_matched ? (<><span>·</span><Pill tone={j.on_time ? "green" : "amber"}>{j.on_time ? "on-time" : "late"}</Pill><span>{(j.time_on_site_minutes as number) ?? "—"}min</span></>) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No job matches." variant="outlined" />}
          </Section>

          <Section title={`Communications (${results.comms.length})`}>
            {results.comms.length > 0 ? (
              <ul className="space-y-2">
                {results.comms.map((m: Record<string, unknown>) => (
                  <li key={m.id as number} className="rounded-2xl border border-neutral-200 bg-white p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                      <span className="font-mono">
                        {new Date(m.occurred_at as string).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                      </span>
                      <Pill tone="slate">{m.channel as string}</Pill>
                      {m.direction ? <Pill tone="slate">{m.direction as string}</Pill> : null}
                      {m.tech_short_name ? <span>· {m.tech_short_name as string}</span> : null}
                      <span className="ml-auto">imp {(m.importance as number) ?? "—"}</span>
                    </div>
                    <p className="text-sm text-neutral-800">
                      <strong>
                        {m.hcp_customer_id ? (
                          <Link href={`/customer/${m.hcp_customer_id}`} className="hover:underline">
                            {(m.customer_name as string) ?? "(no name)"}
                          </Link>
                        ) : (m.customer_name as string) ?? "(no name)"}
                        :
                      </strong>{" "}
                      {m.summary as string}
                    </p>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No comms matches." variant="outlined" />}
          </Section>

          {results.semantic && (
            <Section
              title="Semantic matches"
              description="Embedding-similarity fallback (cosine ≥ 0.5) — surfaces what keyword search may miss."
            >
              {(["job", "customer", "communication_event"] as const).map((kind) => {
                const items = results.semantic?.results[kind] ?? [];
                if (items.length === 0) return null;
                return (
                  <div key={kind} className="mb-4">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      {kind === "communication_event" ? "Comm events" : kind === "job" ? "Jobs" : "Customers"} ({items.length})
                    </h3>
                    <ul className="space-y-2">
                      {items.map((it, i) => {
                        const sim = Number(it.similarity ?? 0).toFixed(2);
                        if (kind === "job") {
                          return (
                            <li key={`j-${i}`} className="rounded-2xl border border-neutral-200 bg-white p-3 transition hover:border-neutral-300 hover:shadow-sm">
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <Link href={`/job/${it.hcp_job_id}`} className="font-medium text-neutral-900 hover:underline">
                                  {(it.customer_name as string) ?? "(no name)"}
                                </Link>
                                <div className="flex items-center gap-2 text-xs text-neutral-500">
                                  <Pill tone="brand" mono>sim {sim}</Pill>
                                  <span>{(it.job_date as string) ?? "—"}</span>
                                  <span>·</span>
                                  <span>{(it.tech_primary_name as string) ?? "—"}</span>
                                  {it.revenue != null ? (<><span>·</span><span>{fmtMoney(it.revenue)}</span></>) : null}
                                </div>
                              </div>
                              <p className="mt-1 max-w-3xl whitespace-pre-line text-xs italic text-neutral-600">
                                {((it.text_preview as string) ?? "").slice(0, 220)}
                              </p>
                            </li>
                          );
                        }
                        if (kind === "customer") {
                          return (
                            <li key={`c-${i}`} className="rounded-2xl border border-neutral-200 bg-white p-3 transition hover:border-neutral-300 hover:shadow-sm">
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <Link href={`/customer/${it.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">
                                  {it.customer_name as string}
                                </Link>
                                <div className="flex items-center gap-2 text-xs text-neutral-500">
                                  <Pill tone="brand" mono>sim {sim}</Pill>
                                  <span>{(it.lifetime_job_count as number) ?? 0} jobs</span>
                                  <span>·</span>
                                  <span>{(it.comm_count_90d as number) ?? 0} comms 90d</span>
                                  {Number(it.outstanding_due_dollars) > 0 ? (
                                    <span className="text-red-700">· {fmtMoney(it.outstanding_due_dollars)} due</span>
                                  ) : null}
                                </div>
                              </div>
                              <p className="mt-1 max-w-3xl text-xs italic text-neutral-600">
                                {((it.text_preview as string) ?? "").slice(0, 200)}
                              </p>
                            </li>
                          );
                        }
                        return (
                          <li key={`m-${i}`} className="rounded-2xl border border-neutral-200 bg-white p-3">
                            <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
                              <Pill tone="brand" mono>sim {sim}</Pill>
                              <span className="font-mono">
                                {new Date(it.occurred_at as string).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                              </span>
                              <Pill tone="slate">{it.channel as string}</Pill>
                              {it.direction ? <Pill tone="slate">{it.direction as string}</Pill> : null}
                            </div>
                            <p className="text-sm text-neutral-800">
                              <strong>
                                {it.hcp_customer_id ? (
                                  <Link href={`/customer/${it.hcp_customer_id}`} className="hover:underline">
                                    {(it.customer_name as string) ?? "(no name)"}
                                  </Link>
                                ) : (it.customer_name as string) ?? "(no name)"}
                                :
                              </strong>{" "}
                              {it.summary as string}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </Section>
          )}
        </div>
      )}
    </PageShell>
  );
}
