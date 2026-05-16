// /admin/system — live system map.
//
// Built 2026-05-16 in response to "Danny shouldn't be the holder of system
// knowledge." Pulls live state from the DB so the next "where does this
// data come from?" question has a self-serve answer.
//
// Sections (top → bottom = most-likely-to-be-broken first):
//   1. Pipeline freshness — per-table most-recent-row + row count + stale flag
//   2. Crons — schedule, last logged fire, fires/errors in last 24h
//   3. Webhook activity — event types received in last 24h, grouped
//   4. Edge function activity — maintenance_logs summary by source
//
// Admin + manager gated (it shows internal plumbing).

import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { Section } from "../../../components/ui/Section";
import { Pill } from "../../../components/ui/Pill";
import { getCurrentTech } from "../../../lib/current-tech";

export const metadata = { title: "System Map · Admin · TPAR-DB" };
export const dynamic = "force-dynamic";

type WatchedTable = {
  table_name: string;
  ts_col: string;
  surface_intent: string;
  approx_rows: number | null;
};

type FreshnessRow = WatchedTable & {
  most_recent_row: string | null;
  age_hours: number | null;
};

type CronRow = {
  jobid: number;
  jobname: string;
  schedule: string;
  active: boolean;
  command_preview: string;
  target_url: string | null;
  last_logged_fire: string | null;
  fires_24h: number;
  errors_24h: number;
};

type WebhookRow = {
  source_system: string;
  event_type: string;
  n_1h: number;
  n_24h: number;
  n_7d: number;
  most_recent: string;
  handler_function: string | null;
  writes_to: string[] | null;
};

type FunctionRow = {
  source: string;
  n_1h: number;
  n_24h: number;
  n_7d: number;
  errors_24h: number;
  last_fired: string;
};

type McpToolRow = {
  server_slug: string;
  tool_name: string;
  intent: string | null;
  reads_from: string[] | null;
  writes_to: string[] | null;
  notes: string | null;
  last_called: string | null;
};

type EdgeFunctionRow = {
  slug: string;
  verify_jwt: boolean;
  expected_auth: string | null;
  auth_mismatch: boolean;
  intent: string | null;
  writes_to: string[] | null;
  triggered_by: string | null;
  version: number | null;
  last_deployed_at: string | null;
  notes: string | null;
  last_synced_at: string;
  n_1h: number | null;
  n_24h: number | null;
  n_7d: number | null;
  errors_24h: number | null;
  last_fired: string | null;
};

function ageHours(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function fmtAge(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.floor(hours / 24)}d`;
}

function stalenessTone(hours: number | null, threshold_hours: number): "green" | "amber" | "red" | "slate" {
  if (hours == null) return "slate";
  if (hours <= threshold_hours) return "green";
  if (hours <= threshold_hours * 4) return "amber";
  return "red";
}

// Sensible per-table staleness thresholds (in hours). Anything older than
// this means the pipeline is plausibly broken. Tuned to real cadences.
const STALENESS_HOURS: Record<string, number> = {
  text_messages: 2,
  call_transcripts: 2,
  communication_events: 2,
  hcp_jobs_raw: 6,           // depends on HCP activity volume
  hcp_estimates_raw: 24,
  hcp_invoices_raw: 24,
  hcp_customers_raw: 168,
  hcp_pipeline_estimates_raw: 2,
  appointments_master: 6,
  jobs_master: 24,
  bouncie_trips: 1,
  tech_time_entries: 24,     // techs may not clock in every hour
  entity_embeddings: 2,
  job_lifecycle_events: 24,
  oauth_tokens: 168,
  maintenance_logs: 0.25,    // pg_cron_heartbeat fires every 15 min
};

export default async function SystemMapPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/admin/system");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  const supa = db();

  // Pull the catalog rows first, then run one freshness query per table in
  // parallel (each table has a different timestamp column, so a single
  // SELECT can't fold them all together without dynamic SQL).
  const [watchedRes, cronsRes, webhooksRes, functionsRes, edgeFnRes, mcpToolsRes] = await Promise.all([
    supa.from("system_table_freshness_v").select("table_name, ts_col, surface_intent, approx_rows"),
    supa.from("system_crons_v").select("*").order("jobname"),
    supa.from("system_webhook_activity_v").select("*").order("n_24h", { ascending: false }).limit(30),
    supa.from("system_function_activity_v").select("*").order("n_24h", { ascending: false }).limit(40),
    supa.from("system_edge_functions_v").select("*").order("slug"),
    supa.from("system_mcp_tools_v").select("*").order("server_slug").order("tool_name"),
  ]);

  const watched: WatchedTable[] = (watchedRes.data ?? []) as WatchedTable[];

  // Per-table most_recent_row probes — service-role; safe.
  const freshness: FreshnessRow[] = await Promise.all(
    watched.map(async (w): Promise<FreshnessRow> => {
      const { data } = await supa
        .from(w.table_name)
        .select(w.ts_col)
        .order(w.ts_col, { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      const ts = (data as Record<string, string | null> | null)?.[w.ts_col] ?? null;
      return { ...w, most_recent_row: ts, age_hours: ageHours(ts) };
    }),
  );

  freshness.sort((a, b) => (a.age_hours ?? 0) - (b.age_hours ?? 0)); // freshest first
  const staleCount = freshness.filter((r) => {
    const t = STALENESS_HOURS[r.table_name] ?? 24;
    return (r.age_hours ?? Infinity) > t;
  }).length;

  const crons: CronRow[] = (cronsRes.data ?? []) as CronRow[];
  const webhooks: WebhookRow[] = (webhooksRes.data ?? []) as WebhookRow[];
  const functions: FunctionRow[] = (functionsRes.data ?? []) as FunctionRow[];
  const edgeFns: EdgeFunctionRow[] = (edgeFnRes.data ?? []) as EdgeFunctionRow[];
  const mcpTools: McpToolRow[] = (mcpToolsRes.data ?? []) as McpToolRow[];
  const mismatchCount = edgeFns.filter((f) => f.auth_mismatch).length;
  // Sort: mismatches first (so they're impossible to miss), then by 24h activity.
  edgeFns.sort((a, b) => {
    if (a.auth_mismatch !== b.auth_mismatch) return a.auth_mismatch ? -1 : 1;
    return (b.n_24h ?? 0) - (a.n_24h ?? 0);
  });

  return (
    <PageShell kicker="Admin" title="System Map" backHref="/admin" backLabel="Admin">
      <div className="space-y-6">
        <Section title={`Pipeline freshness${staleCount > 0 ? ` · ${staleCount} stale` : ""}`}>
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Table</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Surface / source</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Latest row</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">Age</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">~Rows</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {freshness.map((r) => {
                  const threshold = STALENESS_HOURS[r.table_name] ?? 24;
                  return (
                    <tr key={r.table_name} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 font-mono text-neutral-800">{r.table_name}</td>
                      <td className="px-4 py-2 text-neutral-700">{r.surface_intent}</td>
                      <td className="px-4 py-2 font-mono text-neutral-500">
                        {r.most_recent_row
                          ? new Date(r.most_recent_row).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })
                          : "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Pill tone={stalenessTone(r.age_hours, threshold)}>{fmtAge(r.age_hours)}</Pill>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-700">
                        {r.approx_rows != null ? r.approx_rows.toLocaleString() : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={`Edge functions (${edgeFns.length}${mismatchCount > 0 ? ` · ${mismatchCount} auth mismatch` : ""})`}>
          {mismatchCount > 0 ? (
            <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <strong>{mismatchCount} function{mismatchCount === 1 ? "" : "s"}</strong> have <code className="font-mono">verify_jwt: true</code> but use a non-JWT auth scheme. The Supabase gateway will 401 every caller before the function code runs. This is the failure mode from 2026-05-15 (store-text-message, transcribe-and-store-call).
            </p>
          ) : null}
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Function</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Trigger</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Intent</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Writes to</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">JWT</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Auth</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">v</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Deployed</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">24h</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">Err</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {edgeFns.map((f) => (
                  <tr key={f.slug} id={f.slug} className={f.auth_mismatch ? "bg-red-50 hover:bg-red-100 scroll-mt-20" : "hover:bg-neutral-50 scroll-mt-20"}>
                    <td className="px-4 py-2 font-mono text-neutral-800 align-top">{f.slug}</td>
                    <td className="px-4 py-2 align-top">
                      {f.triggered_by ? <Pill tone="slate">{f.triggered_by}</Pill> : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-neutral-700 align-top max-w-md">
                      {f.intent ? <span className="text-xs leading-relaxed">{f.intent}</span> : <span className="text-neutral-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2 align-top">
                      {f.writes_to && f.writes_to.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {f.writes_to.map((t) => (
                            <span key={t} className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-700">{t}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 align-top">
                      {f.verify_jwt ? <Pill tone={f.auth_mismatch ? "red" : "slate"}>true</Pill> : <Pill tone="green">false</Pill>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-neutral-700 align-top">{f.expected_auth ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-500 align-top">{f.version ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-neutral-500 align-top">
                      {f.last_deployed_at
                        ? new Date(f.last_deployed_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short" })
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-700 align-top">{f.n_24h ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums align-top">
                      {(f.errors_24h ?? 0) > 0 ? <span className="text-red-700">{f.errors_24h}</span> : <span className="text-neutral-400">0</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            verify_jwt + expected_auth are hand-maintained in <code className="font-mono">public.system_edge_functions</code>. Sync by re-running the seed against the live Management API state — drift between this table and actual is the regression we're trying to surface.
          </p>
        </Section>

        <Section title={`Crons (${crons.length})`}>
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Job</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Schedule</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Target</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Last fire</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">24h</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">Err 24h</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {crons.map((c) => (
                  <tr key={c.jobid} className="hover:bg-neutral-50">
                    <td className="px-4 py-2 font-mono text-neutral-800">{c.jobname}</td>
                    <td className="px-4 py-2 font-mono text-neutral-700">{c.schedule}</td>
                    <td className="px-4 py-2 font-mono text-xs text-neutral-600">
                      {c.target_url
                        ? c.target_url.replace(/^https?:\/\/[^/]+\/(functions\/v1\/)?/, "")
                        : c.command_preview.includes("public.")
                          ? c.command_preview.match(/public\.\w+/)?.[0] ?? "—"
                          : "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-neutral-500">
                      {c.last_logged_fire
                        ? new Date(c.last_logged_fire).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{c.fires_24h}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {c.errors_24h > 0 ? <span className="text-red-700">{c.errors_24h}</span> : <span className="text-neutral-400">0</span>}
                    </td>
                    <td className="px-4 py-2">
                      {c.active ? <Pill tone="green">active</Pill> : <Pill tone="slate">paused</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Webhook activity (last 7d, top 30 by 24h volume)">
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Source</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Event type</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Handler</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Writes to</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">24h</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">7d</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Most recent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {webhooks.map((w) => (
                  <tr key={`${w.source_system}-${w.event_type}`} className="hover:bg-neutral-50">
                    <td className="px-4 py-2 text-neutral-700 align-top">{w.source_system}</td>
                    <td className="px-4 py-2 font-mono text-neutral-800 align-top">{w.event_type}</td>
                    <td className="px-4 py-2 font-mono text-xs text-neutral-700 align-top">{w.handler_function ?? <span className="text-red-700">unmapped</span>}</td>
                    <td className="px-4 py-2 align-top">
                      {w.writes_to && w.writes_to.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {w.writes_to.map((t) => (
                            <span key={t} className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-700">{t}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-700 align-top">{w.n_24h}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-500 align-top">{w.n_7d}</td>
                    <td className="px-4 py-2 font-mono text-neutral-500 align-top">
                      {new Date(w.most_recent).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Edge function activity (maintenance_logs, last 7d)">
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Source</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">1h</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">24h</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">7d</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">Err 24h</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Last fired</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {functions.map((f) => (
                  <tr key={f.source} className="hover:bg-neutral-50">
                    <td className="px-4 py-2 font-mono text-neutral-800">{f.source}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{f.n_1h}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{f.n_24h}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-500">{f.n_7d}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {f.errors_24h > 0 ? <span className="text-red-700">{f.errors_24h}</span> : <span className="text-neutral-400">0</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-neutral-500">
                      {new Date(f.last_fired).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title={`MCP tools (${mcpTools.length})`}>
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Server</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Tool</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Intent</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Reads</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Writes</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Last called</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {mcpTools.map((t) => (
                  <tr key={`${t.server_slug}-${t.tool_name}`} className="hover:bg-neutral-50">
                    <td className="px-4 py-2 font-mono text-xs text-neutral-700 align-top">{t.server_slug}</td>
                    <td className="px-4 py-2 font-mono text-neutral-800 align-top">{t.tool_name}</td>
                    <td className="px-4 py-2 text-xs text-neutral-700 leading-relaxed align-top max-w-md">{t.intent ?? "—"}</td>
                    <td className="px-4 py-2 align-top">
                      {t.reads_from && t.reads_from.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {t.reads_from.map((r) => (
                            <span key={r} className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-700">{r}</span>
                          ))}
                        </div>
                      ) : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-4 py-2 align-top">
                      {t.writes_to && t.writes_to.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {t.writes_to.map((w) => (
                            <span key={w} className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-700">{w}</span>
                          ))}
                        </div>
                      ) : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-neutral-500 align-top">
                      {t.last_called
                        ? new Date(t.last_called).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            MCP tool manifest is hand-maintained in <code className="font-mono">public.system_mcp_tools</code>. The mcp-tpar server exposes these to Claude.ai mobile/web/desktop and Claude Code via Bearer MCP_TPAR_TOKEN.
          </p>
        </Section>
      </div>
    </PageShell>
  );
}
