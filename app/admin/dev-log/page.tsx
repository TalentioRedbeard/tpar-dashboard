// /admin/dev-log — narrative compaction of TPAR development per Chicago day.
// Source: dev_session_log table, written nightly by dev-session-compact edge fn.
// Admin-only (Phase 3 Tier 3 gate).

import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { getSessionUser } from "../../../lib/supabase-server";
import { isAdmin } from "../../../lib/admin";
import { PageShell } from "../../../components/PageShell";
import { RunCompactButton } from "../../../components/RunCompactButton";

export const metadata = { title: "Dev log · Admin · TPAR-DB" };

type Decision = { topic?: string; decision?: string; why?: string };
type OpenThread = { thread?: string; why_open?: string; blocker?: string };
type Feature = { name?: string; blast_radius?: string };
type FileTouched = { path?: string; change_kind?: string };

type Row = {
  id: number;
  log_date: string;
  summary: string | null;
  decisions: Decision[] | null;
  open_threads: OpenThread[] | null;
  features_shipped: Feature[] | null;
  files_touched: FileTouched[] | null;
  source_log_count: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  model: string | null;
  generated_at: string;
  error: string | null;
};

export default async function DevLogPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");

  const supa = db();
  const { data, error } = await supa
    .from("dev_session_log")
    .select("*")
    .order("log_date", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as Row[];

  return (
    <PageShell
      title="Dev log"
      description="Nightly narrative compaction of TPAR development. Source: 24h of maintenance_logs (heartbeat sources excluded) + Claude Haiku. Cron fires 04:00 UTC (≈23:00 CDT)."
    >
      <div className="mb-6">
        <RunCompactButton />
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Failed to load: {error.message}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No dev-log entries yet. Run the compact function manually or wait for the nightly cron.
        </p>
      ) : (
        <ul className="space-y-6">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-neutral-200 bg-white p-5">
              <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-100 pb-2">
                <div>
                  <h2 className="text-lg font-semibold text-neutral-900">{r.log_date}</h2>
                  <p className="text-xs text-neutral-500">
                    {r.source_log_count ?? 0} log rows
                    {r.prompt_tokens != null && r.completion_tokens != null
                      ? ` · ${r.prompt_tokens.toLocaleString()} in / ${r.completion_tokens.toLocaleString()} out tokens`
                      : ""}
                    {r.model ? ` · ${r.model}` : ""}
                  </p>
                </div>
                <span className="text-xs text-neutral-400">
                  generated {new Date(r.generated_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                </span>
              </header>

              {r.error ? (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  Compaction failed: {r.error}
                </div>
              ) : null}

              {r.summary ? (
                <p className="mb-4 whitespace-pre-line text-sm leading-relaxed text-neutral-800">{r.summary}</p>
              ) : null}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <ListBlock title="Features shipped" rows={r.features_shipped ?? []} render={(f) => (
                  <>
                    <span className="font-medium text-neutral-900">{f.name ?? "—"}</span>
                    {f.blast_radius ? <span className="ml-1 text-neutral-500">· {f.blast_radius}</span> : null}
                  </>
                )} />

                <ListBlock title="Decisions" rows={r.decisions ?? []} render={(d) => (
                  <>
                    <div className="font-medium text-neutral-900">{d.topic ?? "—"}</div>
                    {d.decision ? <div className="text-neutral-700">{d.decision}</div> : null}
                    {d.why ? <div className="text-xs italic text-neutral-500">{d.why}</div> : null}
                  </>
                )} />

                <ListBlock title="Open threads" rows={r.open_threads ?? []} render={(t) => (
                  <>
                    <div className="font-medium text-neutral-900">{t.thread ?? "—"}</div>
                    {t.why_open ? <div className="text-neutral-700">{t.why_open}</div> : null}
                    {t.blocker ? <div className="text-xs italic text-amber-700">blocker: {t.blocker}</div> : null}
                  </>
                )} />

                <ListBlock title="Files touched" rows={r.files_touched ?? []} render={(f) => (
                  <>
                    <span className="font-mono text-xs text-neutral-700">{f.path ?? "—"}</span>
                    {f.change_kind ? <span className="ml-1 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">{f.change_kind}</span> : null}
                  </>
                )} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function ListBlock<T>({ title, rows, render }: { title: string; rows: T[]; render: (r: T) => React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-neutral-400">—</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="text-sm text-neutral-700">{render(r)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
