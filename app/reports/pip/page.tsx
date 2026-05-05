// PIP report — Process / Product / Performance.
//
// Mirrors the tpar_pip_report MCP tool, but server-rendered as HTML for the
// dashboard. Three sections, one query each, all parallel:
//
//   Process     → topic / flag / sentiment distribution across all comm
//                 events in the window (operational signal: are we on top
//                 of inbound? are spam filters healthy? etc.)
//   Product    → top recurring counterparties + estimate-friction +
//                 scheduling-friction signals (where the work itself is
//                 grinding)
//   Performance → per-tech metrics from the same comm corpus (call/text
//                 volume, voicemail-hit rate, sentiment, open loops)

import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";

export const metadata = { title: "PIP report · TPAR-DB" };

// Heavy aggregation queries — never prerender. The DB statement timeout was
// killing the Vercel build (2026-05-05).
export const dynamic = "force-dynamic";

const DAYS = 30;

type ProcessRow = {
  scope: string;
  days: number;
  total_events: number;
  spam_count: number;
  vendor_solicit_count: number;
  outbound_voicemail_hits: number;
  outbound_calls_total: number;
  top_topics: Array<{ topic: string; n: number }> | null;
  top_flags: Array<{ flag: string; n: number }> | null;
  sentiment_breakdown: Array<{ sentiment: string | null; n: number }> | null;
};

type ProductRow = {
  scope: string;
  days: number;
  top_recurring_counterparties: Array<{
    customer_name: string;
    interactions: number;
    avg_imp: number;
    topics: string[];
  }> | null;
  estimate_friction_signals: Array<{
    id: number;
    occurred_at: string;
    channel: string;
    customer_name: string | null;
    summary: string | null;
    flags: string[] | null;
    importance: number | null;
  }> | null;
  scheduling_friction_signals: Array<{
    id: number;
    occurred_at: string;
    channel: string;
    customer_name: string | null;
    summary: string | null;
    flags: string[] | null;
    importance: number | null;
  }> | null;
};

type TechRow = {
  tech: string;
  days: number;
  total_events: number;
  calls: number;
  texts: number;
  outbound: number;
  inbound: number;
  voicemail_hits: number;
  negative_count: number;
  positive_count: number;
  open_loops: number;
  avg_call_dur_sec: number | null;
  total_call_min: number | null;
  avg_importance: number | null;
};

async function runReadonly<T>(supa: ReturnType<typeof db>, sql: string): Promise<T[]> {
  const { data, error } = await supa.rpc("mcp_query_readonly", { query_text: sql });
  if (error) throw new Error(`mcp_query_readonly: ${error.message}`);
  return (data ?? []) as T[];
}

const PROCESS_SQL = `
  SELECT
    'process' AS scope,
    ${DAYS} AS days,
    (SELECT COUNT(*) FROM communication_events WHERE occurred_at > now() - interval '${DAYS} days') AS total_events,
    (SELECT COUNT(*) FROM communication_events WHERE occurred_at > now() - interval '${DAYS} days' AND 'spam' = ANY(flags)) AS spam_count,
    (SELECT COUNT(*) FROM communication_events WHERE occurred_at > now() - interval '${DAYS} days' AND 'vendor_solicitation' = ANY(flags)) AS vendor_solicit_count,
    (SELECT COUNT(*) FROM communication_events WHERE occurred_at > now() - interval '${DAYS} days' AND channel='call' AND direction='outbound' AND 'voicemail' = ANY(flags)) AS outbound_voicemail_hits,
    (SELECT COUNT(*) FROM communication_events WHERE occurred_at > now() - interval '${DAYS} days' AND channel='call' AND direction='outbound') AS outbound_calls_total,
    (SELECT json_agg(t) FROM (
      SELECT unnest(topics) AS topic, COUNT(*) AS n
      FROM communication_events
      WHERE occurred_at > now() - interval '${DAYS} days' AND topics IS NOT NULL
      GROUP BY 1 ORDER BY n DESC LIMIT 12
    ) t) AS top_topics,
    (SELECT json_agg(f) FROM (
      SELECT unnest(flags) AS flag, COUNT(*) AS n
      FROM communication_events
      WHERE occurred_at > now() - interval '${DAYS} days' AND flags IS NOT NULL
      GROUP BY 1 ORDER BY n DESC LIMIT 12
    ) f) AS top_flags,
    (SELECT json_agg(s) FROM (
      SELECT sentiment, COUNT(*) AS n
      FROM communication_events
      WHERE occurred_at > now() - interval '${DAYS} days'
      GROUP BY 1
    ) s) AS sentiment_breakdown
`;

const PRODUCT_SQL = `
  WITH base AS (
    SELECT * FROM communication_events
    WHERE occurred_at > now() - interval '${DAYS} days'
  )
  SELECT
    'product' AS scope,
    ${DAYS} AS days,
    (SELECT json_agg(c) FROM (
      SELECT customer_name, COUNT(*) AS interactions, ROUND(AVG(importance), 1) AS avg_imp,
             array_agg(DISTINCT t) AS topics
      FROM base, unnest(COALESCE(topics, ARRAY[]::text[])) AS t
      WHERE customer_name IS NOT NULL
      GROUP BY customer_name
      HAVING COUNT(*) >= 3
      ORDER BY interactions DESC
      LIMIT 15
    ) c) AS top_recurring_counterparties,
    (SELECT json_agg(s) FROM (
      SELECT id, occurred_at::timestamp(0) AS occurred_at, channel, customer_name, summary, flags, importance
      FROM base
      WHERE 'estimate' = ANY(topics)
        AND ('unresolved' = ANY(flags) OR 'needs_followup' = ANY(flags) OR 'customer_frustrated' = ANY(flags))
      ORDER BY importance DESC NULLS LAST, occurred_at DESC
      LIMIT 10
    ) s) AS estimate_friction_signals,
    (SELECT json_agg(s) FROM (
      SELECT id, occurred_at::timestamp(0) AS occurred_at, channel, customer_name, summary, flags, importance
      FROM base
      WHERE 'scheduling' = ANY(topics)
        AND ('unresolved' = ANY(flags) OR 'needs_followup' = ANY(flags))
      ORDER BY importance DESC NULLS LAST, occurred_at DESC
      LIMIT 10
    ) s) AS scheduling_friction_signals
`;

const TECH_SQL = `
  WITH active_techs AS (
    SELECT tech_short_name AS tech FROM tech_directory WHERE is_active = true
  ),
  events AS (
    SELECT * FROM communication_events
    WHERE occurred_at > now() - interval '${DAYS} days'
      AND tech_short_name IS NOT NULL
  )
  SELECT
    a.tech,
    ${DAYS} AS days,
    COUNT(e.*) AS total_events,
    COUNT(*) FILTER (WHERE e.channel='call') AS calls,
    COUNT(*) FILTER (WHERE e.channel='text') AS texts,
    COUNT(*) FILTER (WHERE e.direction='outbound') AS outbound,
    COUNT(*) FILTER (WHERE e.direction='inbound')  AS inbound,
    COUNT(*) FILTER (WHERE 'voicemail' = ANY(e.flags)) AS voicemail_hits,
    COUNT(*) FILTER (WHERE e.sentiment='negative') AS negative_count,
    COUNT(*) FILTER (WHERE e.sentiment='positive') AS positive_count,
    COUNT(*) FILTER (WHERE 'needs_followup' = ANY(e.flags) OR 'unresolved' = ANY(e.flags)) AS open_loops,
    ROUND(AVG(e.duration_sec) FILTER (WHERE e.channel='call'))::int AS avg_call_dur_sec,
    ROUND(SUM(e.duration_sec) FILTER (WHERE e.channel='call') / 60.0, 1) AS total_call_min,
    ROUND(AVG(e.importance), 2) AS avg_importance
  FROM active_techs a
  LEFT JOIN events e ON e.tech_short_name = a.tech
  GROUP BY a.tech
  HAVING COUNT(e.*) > 0
  ORDER BY total_events DESC
`;

function tone(value: number, goodAtMost: number, warnAtMost: number): string {
  if (value <= goodAtMost) return "text-emerald-700";
  if (value <= warnAtMost) return "text-amber-700";
  return "text-red-700";
}

function pct(num: number, denom: number): string {
  if (!denom) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

export default async function PipReport() {
  const supa = db();

  const [processRows, productRows, techRows] = await Promise.all([
    runReadonly<ProcessRow>(supa, PROCESS_SQL),
    runReadonly<ProductRow>(supa, PRODUCT_SQL),
    runReadonly<TechRow>(supa, TECH_SQL),
  ]);

  const proc    = processRows[0];
  const prod    = productRows[0];

  return (
    <PageShell
      title="PIP report"
      description={`Process / Product / Performance — last ${DAYS} days from communication_events.`}
    >
      {/* PROCESS */}
      <section className="mb-10">
        <header className="mb-3">
          <h2 className="text-base font-semibold text-neutral-900">Process</h2>
          <p className="text-xs text-neutral-500">
            Topic and flag distribution across all comm traffic. Spam + vendor-solicitation share is a filter-quality signal; outbound-VM rate is a reach signal.
          </p>
        </header>

        {proc ? (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat label="Total events" value={proc.total_events.toString()} />
              <Stat label="Spam" value={proc.spam_count.toString()} sub={pct(proc.spam_count, proc.total_events)} />
              <Stat label="Vendor solicit." value={proc.vendor_solicit_count.toString()} sub={pct(proc.vendor_solicit_count, proc.total_events)} />
              <Stat
                label="Outbound calls"
                value={proc.outbound_calls_total.toString()}
                sub={`${proc.outbound_voicemail_hits} VM (${pct(proc.outbound_voicemail_hits, proc.outbound_calls_total)})`}
              />
              <Stat label="Sentiment" value={summarizeSentiment(proc.sentiment_breakdown)} />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <DistroCard title="Top topics" rows={proc.top_topics ?? []} keyKey="topic" total={proc.total_events} />
              <DistroCard title="Top flags"  rows={proc.top_flags  ?? []} keyKey="flag"  total={proc.total_events} />
            </div>
          </>
        ) : (
          <p className="text-sm text-neutral-500">No process data.</p>
        )}
      </section>

      {/* PRODUCT */}
      <section className="mb-10">
        <header className="mb-3">
          <h2 className="text-base font-semibold text-neutral-900">Product</h2>
          <p className="text-xs text-neutral-500">
            Where the work is grinding — top recurring counterparties (≥3 interactions in window), plus open estimate &amp; scheduling friction.
          </p>
        </header>

        <div className="mb-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-800">Top recurring counterparties</h3>
          {prod?.top_recurring_counterparties && prod.top_recurring_counterparties.length > 0 ? (
            <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Customer</th>
                    <th className="px-3 py-2 text-right">Interactions</th>
                    <th className="px-3 py-2 text-right">Avg importance</th>
                    <th className="px-3 py-2 text-left">Topics</th>
                  </tr>
                </thead>
                <tbody>
                  {prod.top_recurring_counterparties.map((c) => (
                    <tr key={c.customer_name} className="border-t border-neutral-100">
                      <td className="px-3 py-2 font-medium text-neutral-900">{c.customer_name}</td>
                      <td className="px-3 py-2 text-right">{c.interactions}</td>
                      <td className="px-3 py-2 text-right text-neutral-600">{c.avg_imp ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-neutral-600">{(c.topics ?? []).slice(0, 6).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-neutral-500">None in window.</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FrictionList title="Estimate friction" rows={prod?.estimate_friction_signals ?? []} />
          <FrictionList title="Scheduling friction" rows={prod?.scheduling_friction_signals ?? []} />
        </div>
      </section>

      {/* PERFORMANCE */}
      <section>
        <header className="mb-3">
          <h2 className="text-base font-semibold text-neutral-900">Performance — per tech</h2>
          <p className="text-xs text-neutral-500">
            Comm-channel activity per tech in the window. Open loops = events flagged needs_followup or unresolved.
          </p>
        </header>
        {techRows.length === 0 ? (
          <p className="text-sm text-neutral-500">No tech-attributed comm events in window.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left">Tech</th>
                  <th className="px-3 py-2 text-right">Events</th>
                  <th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2 text-right">Texts</th>
                  <th className="px-3 py-2 text-right">Out / In</th>
                  <th className="px-3 py-2 text-right">VM hits</th>
                  <th className="px-3 py-2 text-right">+ / −</th>
                  <th className="px-3 py-2 text-right">Open loops</th>
                  <th className="px-3 py-2 text-right">Call min</th>
                  <th className="px-3 py-2 text-right">Avg imp</th>
                </tr>
              </thead>
              <tbody>
                {techRows.map((r) => (
                  <tr key={r.tech} className="border-t border-neutral-100">
                    <td className="px-3 py-2 font-medium text-neutral-900">{r.tech}</td>
                    <td className="px-3 py-2 text-right">{r.total_events}</td>
                    <td className="px-3 py-2 text-right">{r.calls}</td>
                    <td className="px-3 py-2 text-right">{r.texts}</td>
                    <td className="px-3 py-2 text-right text-neutral-600">{r.outbound} / {r.inbound}</td>
                    <td className={`px-3 py-2 text-right ${tone(r.calls ? (r.voicemail_hits / r.calls) * 100 : 0, 25, 50)}`}>{r.voicemail_hits}</td>
                    <td className="px-3 py-2 text-right text-neutral-600">{r.positive_count} / {r.negative_count}</td>
                    <td className={`px-3 py-2 text-right ${r.open_loops > 5 ? "font-medium text-red-700" : "text-neutral-700"}`}>{r.open_loops}</td>
                    <td className="px-3 py-2 text-right text-neutral-600">{r.total_call_min ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-neutral-600">{r.avg_importance ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageShell>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="text-xs font-medium text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-neutral-900">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-neutral-500">{sub}</div> : null}
    </div>
  );
}

function DistroCard({
  title,
  rows,
  keyKey,
  total,
}: {
  title: string;
  rows: Array<{ topic?: string; flag?: string; n: number }>;
  keyKey: "topic" | "flag";
  total: number;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-800">{title}</h3>
        <p className="text-xs text-neutral-500">No data.</p>
      </div>
    );
  }
  const max = rows.reduce((m, r) => Math.max(m, r.n), 0);
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-800">{title}</h3>
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const label = (r[keyKey] ?? "(none)") as string;
          const w = Math.max(2, Math.round((r.n / max) * 100));
          return (
            <li key={label} className="flex items-center gap-2 text-sm">
              <span className="w-32 truncate text-neutral-700">{label}</span>
              <div className="flex-1 rounded-full bg-neutral-100">
                <div className="h-2 rounded-full bg-neutral-700" style={{ width: `${w}%` }} />
              </div>
              <span className="w-10 text-right tabular-nums text-neutral-600">{r.n}</span>
              <span className="w-10 text-right text-xs text-neutral-400">{pct(r.n, total)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FrictionList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    id: number;
    occurred_at: string;
    channel: string;
    customer_name: string | null;
    summary: string | null;
    flags: string[] | null;
    importance: number | null;
  }>;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-800">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-neutral-500">Nothing flagged.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.id} className="border-b border-neutral-100 pb-2 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-2 text-xs text-neutral-500">
                <span className="font-mono">{r.occurred_at?.slice(0, 16).replace("T", " ")}</span>
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 uppercase">{r.channel}</span>
                {r.importance != null ? <span>imp {r.importance}</span> : null}
                {r.customer_name ? <span className="font-medium text-neutral-700">{r.customer_name}</span> : null}
              </div>
              <div className="mt-1 text-sm text-neutral-800">{r.summary ?? "(no summary)"}</div>
              {r.flags && r.flags.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.flags.map((f) => (
                    <span key={f} className="rounded-full bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">{f}</span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function summarizeSentiment(rows: Array<{ sentiment: string | null; n: number }> | null): string {
  if (!rows || rows.length === 0) return "—";
  const total = rows.reduce((s, r) => s + r.n, 0);
  if (!total) return "—";
  const find = (s: string | null) => rows.find((r) => r.sentiment === s)?.n ?? 0;
  const pos = find("positive");
  const neg = find("negative");
  return `+${pct(pos, total)} / −${pct(neg, total)}`;
}
