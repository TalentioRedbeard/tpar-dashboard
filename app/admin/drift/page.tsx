// /admin/drift — TPAR-IT-BOT drift report (the open reality-vs-intent findings).
//
// Source: it_drift_open_v (open findings) + it_drift_runs (the nightly refresh log,
// from it-bot-refresh / cron it_bot_refresh_nightly). Surfaces the Management-PAT
// status prominently — while it's invalid, the advisor + edge-fn-parity checks
// (the highest-value ones) can't run. Admin-only.

import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { getSessionUser } from "../../../lib/supabase-server";
import { isAdmin } from "../../../lib/admin";
import { PageShell } from "../../../components/PageShell";
import { AskBox } from "./AskBox";

export const metadata = { title: "Drift · Admin · TPAR-DB" };
export const dynamic = "force-dynamic";

type Finding = {
  id: string;
  domain: string;
  kind: string;
  severity: string;
  title: string | null;
  reality_value: string | null;
  remediation_hint: string | null;
  first_seen: string;
  last_seen: string;
};

const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function sevClasses(sev: string): string {
  if (sev === "critical") return "bg-red-100 text-red-800 ring-red-300";
  if (sev === "high") return "bg-red-50 text-red-700 ring-red-200";
  if (sev === "medium") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (sev === "low") return "bg-sky-50 text-sky-700 ring-sky-200";
  return "bg-neutral-100 text-neutral-600 ring-neutral-200";
}

function fmtChi(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function DriftPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");

  const supa = db();
  const { data: rawFindings } = await supa
    .from("it_drift_open_v")
    .select("id,domain,kind,severity,title,reality_value,remediation_hint,first_seen,last_seen")
    .limit(500);
  const findings = ((rawFindings ?? []) as Finding[]).sort(
    (a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) || (b.last_seen > a.last_seen ? 1 : -1),
  );

  const { data: runs } = await supa
    .from("it_drift_runs")
    .select("trigger,started_at,finished_at,open_count,new_count,resolved_count,checks,error")
    .order("started_at", { ascending: false })
    .limit(1);
  const lastRun = (runs ?? [])[0] as
    | { trigger: string; started_at: string; finished_at: string | null; open_count: number | null; new_count: number | null; resolved_count: number | null; checks: Record<string, unknown> | null; error: string | null }
    | undefined;

  const mgmt = (lastRun?.checks?.["mgmt"] ?? {}) as { ok_domains?: string[]; errors?: string[] };
  const advisorsBlocked = (mgmt.errors ?? []).some((e) => /HTTP 40[13]/.test(e));

  const bySev = findings.reduce<Record<string, number>>((acc, f) => { acc[f.severity] = (acc[f.severity] ?? 0) + 1; return acc; }, {});

  return (
    <PageShell
      title="Drift report"
      kicker="Admin · IT-bot"
      description={
        <>
          Open reality-vs-intent findings from <code className="text-xs">it_drift_open_v</code>, refreshed nightly by
          <code className="mx-1 text-xs">it-bot-refresh</code>. Last run: {fmtChi(lastRun?.started_at ?? null)}
          {lastRun ? ` · ${lastRun.open_count ?? "?"} open · ${lastRun.new_count ?? 0} new · ${lastRun.resolved_count ?? 0} resolved` : ""}.
        </>
      }
      backHref="/admin"
      backLabel="Admin home"
    >
      <div>
        <AskBox />

        {advisorsBlocked ? (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="font-semibold">⚠ Advisor + edge-fn-parity checks are blocked — the Supabase Management PAT is invalid (HTTP 401).</div>
            <div className="mt-1 text-red-700">
              The highest-value checks (security/performance advisors, deployed-vs-manifest parity) can&apos;t run until the token is refreshed.
              Generate a new token at <code className="text-xs">supabase.com/dashboard/account/tokens</code>, then update
              <code className="mx-1 text-xs">function_secrets</code> where <code className="text-xs">key=&apos;supabase_management_pat&apos;</code>.
            </div>
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
          {(["critical", "high", "medium", "low", "info"] as const).map((s) =>
            bySev[s] ? (
              <span key={s} className={`inline-block rounded px-2 py-0.5 font-medium ring-1 ring-inset ${sevClasses(s)}`}>{bySev[s]} {s}</span>
            ) : null,
          )}
          {findings.length === 0 ? <span className="text-emerald-700">No open findings 🎉</span> : null}
        </div>

        {findings.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5">Severity</th>
                  <th className="px-4 py-2.5">Domain / kind</th>
                  <th className="px-4 py-2.5">Finding</th>
                  <th className="px-4 py-2.5">Since</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {findings.map((f) => (
                  <tr key={f.id} className="align-top">
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${sevClasses(f.severity)}`}>{f.severity}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      <div className="font-medium text-neutral-700">{f.domain}</div>
                      <div>{f.kind}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900">{f.title}</div>
                      {f.reality_value ? <div className="mt-0.5 text-xs text-neutral-600">{f.reality_value}</div> : null}
                      {f.remediation_hint ? <div className="mt-1 text-xs text-sky-700">→ {f.remediation_hint}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-neutral-400 tabular-nums">{fmtChi(f.first_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {lastRun?.error ? (
          <p className="mt-3 text-[11px] text-neutral-400">Last run note: {lastRun.error}</p>
        ) : null}
      </div>
    </PageShell>
  );
}
