// /admin/lifecycle-mirrors — surface HCP-mirror health for lifecycle events.
//
// Source data:
//   - `maintenance_logs` rows with source='verify-hcp-mirrors' (logged by
//     pg_cron's verify_hcp_mirrors() function every 15 min) — these are the
//     misses (lifecycle events that didn't get a successful mirror log)
//   - `maintenance_logs` rows with source='hcp-trigger-action' — the raw
//     mirror outcomes, used for a quick success-rate snapshot
//
// Admin can retry a missed mirror with one click (calls hcp-trigger-action
// fresh) or mark it resolved if they fixed it directly in HCP.

import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { getSessionUser } from "../../../lib/supabase-server";
import { isAdmin } from "../../../lib/admin";
import { PageShell } from "../../../components/PageShell";
import { LifecycleMirrorActions } from "./LifecycleMirrorActions";

export const metadata = { title: "Lifecycle HCP mirrors · Admin · TPAR-DB" };
export const dynamic = "force-dynamic";

type MissedMirror = {
  log_ts: string;
  event_id: string;
  hcp_job_id: string;
  hcp_action: string;
  trigger_number: number;
  fired_at: string;
  fired_by: string | null;
  reason: string;
};

type RecentOutcome = {
  ts: string;
  level: string;
  context: Record<string, unknown> | null;
};

function fmtChi(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export default async function LifecycleMirrorsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?from=/admin/lifecycle-mirrors");
  if (!isAdmin(user.email)) redirect("/");

  const supa = db();
  const [missedRes, recentRes, resolvedRes] = await Promise.all([
    supa
      .from("maintenance_logs")
      .select("ts,context")
      .eq("source", "verify-hcp-mirrors")
      .eq("level", "warn")
      .gte("ts", new Date(Date.now() - 7 * 86400_000).toISOString())
      .order("ts", { ascending: false })
      .limit(100),
    supa
      .from("maintenance_logs")
      .select("ts,level,context")
      .eq("source", "hcp-trigger-action")
      .gte("ts", new Date(Date.now() - 24 * 3_600_000).toISOString())
      .order("ts", { ascending: false })
      .limit(200),
    supa
      .from("maintenance_logs")
      .select("context")
      .eq("source", "lifecycle-mirror-resolved")
      .gte("ts", new Date(Date.now() - 7 * 86400_000).toISOString())
      .limit(500),
  ]);

  const resolvedIds = new Set<string>(
    ((resolvedRes.data ?? []) as Array<{ context: Record<string, unknown> | null }>)
      .map((r) => (r.context as { event_id?: string } | null)?.event_id)
      .filter((s): s is string => !!s),
  );

  const missed: MissedMirror[] = ((missedRes.data ?? []) as Array<{ ts: string; context: Record<string, unknown> }>)
    .map((r) => {
      const c = r.context ?? {};
      return {
        log_ts: r.ts,
        event_id: String(c.event_id ?? ""),
        hcp_job_id: String(c.hcp_job_id ?? ""),
        hcp_action: String(c.hcp_action ?? ""),
        trigger_number: Number(c.trigger_number ?? 0),
        fired_at: String(c.fired_at ?? ""),
        fired_by: c.fired_by ? String(c.fired_by) : null,
        reason: String(c.reason ?? "unknown"),
      };
    })
    .filter((m) => m.event_id && !resolvedIds.has(m.event_id));

  // Quick 24h health snapshot
  const recent: RecentOutcome[] = (recentRes.data ?? []) as RecentOutcome[];
  let successCount = 0;
  let failCount = 0;
  for (const r of recent) {
    const success = (r.context as { bot_response?: { success?: boolean } } | null)?.bot_response?.success;
    if (success === true) successCount++;
    else if (success === false) failCount++;
  }
  const totalCount = successCount + failCount;
  const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : null;

  return (
    <PageShell
      kicker="Admin · Lifecycle HCP mirrors"
      title="Lifecycle HCP mirror health"
      description={`HCP-mirrored lifecycle triggers (OMW / Start / Finish). Surfaces misses for admin retry. Detection runs every 15 min via pg_cron.`}
    >
      {/* 24-hour health snapshot */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">24h success</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700">{successCount}</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">24h fail</div>
          <div className="mt-1 text-2xl font-bold text-red-700">{failCount}</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">success rate</div>
          <div className="mt-1 text-2xl font-bold text-neutral-900">{successRate == null ? "—" : `${successRate}%`}</div>
        </div>
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-base font-semibold text-neutral-800">
          Open misses ({missed.length})
        </h2>
        {missed.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
            🎉 No open mirror misses in the last 7 days.
          </div>
        ) : (
          <ul className="space-y-2">
            {missed.map((m) => {
              const hcpUrl = `https://pro.housecallpro.com/app/jobs/${m.hcp_job_id}`;
              return (
                <li key={m.event_id} className="rounded-2xl border border-red-200 bg-red-50/50 p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold text-red-900">
                      Trigger {m.trigger_number} ({m.hcp_action})
                    </span>
                    <span className="rounded-md bg-white px-2 py-0.5 text-xs text-red-700 ring-1 ring-inset ring-red-200">
                      {m.reason}
                    </span>
                    <span className="text-xs text-neutral-500">
                      fired {fmtChi(m.fired_at)}{m.fired_by ? ` by ${m.fired_by}` : ""}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <a href={hcpUrl} target="_blank" rel="noreferrer" className="text-neutral-700 hover:underline">
                      Open job in HCP →
                    </a>
                    <span className="text-neutral-400">·</span>
                    <code className="rounded bg-white px-1 text-neutral-700 ring-1 ring-inset ring-neutral-200">{m.hcp_job_id}</code>
                  </div>
                  <div className="mt-2">
                    <LifecycleMirrorActions eventId={m.event_id} hcpJobId={m.hcp_job_id} hcpAction={m.hcp_action} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold text-neutral-800">
          Recent mirror activity (last 24h, {recent.length} entries)
        </h2>
        {recent.length === 0 ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
            No mirror activity logged in 24h.
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            {recent.slice(0, 50).map((r, i) => {
              const ctx = r.context ?? {};
              const success = (ctx as { bot_response?: { success?: boolean } }).bot_response?.success;
              const action = String((ctx as { action?: string }).action ?? "—");
              const jobId = String((ctx as { job_id?: string }).job_id ?? "—");
              const elapsedMs = (ctx as { elapsed_ms?: number }).elapsed_ms;
              return (
                <li key={`${r.ts}-${i}`} className="flex flex-wrap items-baseline gap-2 px-4 py-2 text-xs">
                  <span className={success === true ? "text-emerald-700" : success === false ? "text-red-700" : "text-neutral-500"}>
                    {success === true ? "✓" : success === false ? "✗" : "·"}
                  </span>
                  <span className="font-medium">{action}</span>
                  <code className="rounded bg-neutral-50 px-1 text-neutral-700">{jobId.slice(-12)}</code>
                  {elapsedMs ? <span className="text-neutral-500">{(elapsedMs / 1000).toFixed(1)}s</span> : null}
                  <span className="ml-auto text-neutral-400">{fmtChi(r.ts)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
