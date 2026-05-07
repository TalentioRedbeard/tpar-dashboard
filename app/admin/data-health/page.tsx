// /admin/data-health — operational view of upstream data freshness over time.
//
// Source: data_health_snapshots, written every 15 min by the
// data_health_snapshot_15min cron. Shows:
//   - current state per source (latest snapshot)
//   - 24h sparkline (lag in minutes over time)
//   - alert log (which sources flipped to very-stale, when)
//
// Admin-only.

import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { getSessionUser } from "../../../lib/supabase-server";
import { isAdmin } from "../../../lib/admin";
import { PageShell } from "../../../components/PageShell";

export const metadata = { title: "Data health · Admin · TPAR-DB" };
export const dynamic = "force-dynamic";

type Snapshot = {
  source: string;
  snapshot_at: string;
  last_data_at: string | null;
  minutes_lag: number | null;
  expected_min: number;
  state: "fresh" | "stale" | "very-stale" | "missing";
  alerted: boolean;
};

const SOURCE_ORDER = ["hcp", "salesask", "bouncie", "texts", "calls", "embeddings"];

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function fmtChi(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function stateClasses(state: Snapshot["state"]): string {
  if (state === "fresh") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (state === "stale") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (state === "very-stale") return "bg-red-50 text-red-700 ring-red-200";
  return "bg-neutral-100 text-neutral-600 ring-neutral-200";
}

// Tiny inline SVG sparkline for one source's recent lag history.
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) {
    return <span className="text-[10px] text-neutral-400">no history</span>;
  }
  const w = 120;
  const h = 22;
  const max = Math.max(...points, 1);
  const xs = points.map((_, i) => (i / (points.length - 1)) * w);
  const ys = points.map((p) => h - (p / max) * (h - 2) - 1);
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-5 w-[120px]">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-neutral-500" />
    </svg>
  );
}

export default async function DataHealthPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");

  const supa = db();

  // 1. Latest snapshot per source (DISTINCT ON via ordered subquery + RLS).
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data: rawSnaps } = await supa
    .from("data_health_snapshots")
    .select("source, snapshot_at, last_data_at, minutes_lag, expected_min, state, alerted")
    .gte("snapshot_at", since)
    .order("snapshot_at", { ascending: false })
    .limit(2000);

  const snapshots = (rawSnaps ?? []) as Snapshot[];

  // 2. Group by source. First seen in DESC order = latest.
  const bySrc = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    const arr = bySrc.get(s.source) ?? [];
    arr.push(s);
    bySrc.set(s.source, arr);
  }

  // 3. Build display rows in canonical order.
  const rows = SOURCE_ORDER.map((src) => {
    const list = (bySrc.get(src) ?? []).slice().sort(
      (a, b) => new Date(a.snapshot_at).getTime() - new Date(b.snapshot_at).getTime(),
    );
    const latest = list[list.length - 1] ?? null;
    const lagPoints = list.map((s) => Number(s.minutes_lag ?? 0));
    return { source: src, latest, history: list, lagPoints };
  });

  // 4. Recent alerts (any source where alerted=true, last 24h).
  const alerts = snapshots
    .filter((s) => s.alerted)
    .sort((a, b) => new Date(b.snapshot_at).getTime() - new Date(a.snapshot_at).getTime())
    .slice(0, 20);

  return (
    <PageShell
      title="Data health"
      kicker="Admin"
      description={
        <>
          Snapshots every 15 min from <code className="text-xs">data_health_snapshots</code>. State =
          <span className="ml-1 mr-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200">fresh</span>
          <span className="mr-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset bg-amber-50 text-amber-800 ring-amber-200">stale</span>
          <span className="mr-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset bg-red-50 text-red-700 ring-red-200">very-stale</span>
          (≥ 2× expected lag → DM Danny, 4h cooldown).
        </>
      }
      backHref="/admin"
      backLabel="Admin home"
    >
      <div>
        <section className="mb-8">
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5">Source</th>
                  <th className="px-4 py-2.5">State</th>
                  <th className="px-4 py-2.5">Last data</th>
                  <th className="px-4 py-2.5">Lag</th>
                  <th className="px-4 py-2.5">Expected</th>
                  <th className="px-4 py-2.5">24h lag history</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((r) => (
                  <tr key={r.source}>
                    <td className="px-4 py-3 font-medium text-neutral-900">{r.source}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${stateClasses(r.latest?.state ?? "missing")}`}>
                        {r.latest?.state ?? "no data"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-700 tabular-nums">
                      <div>{fmtChi(r.latest?.last_data_at ?? null)}</div>
                      <div className="text-[10px] text-neutral-400">{fmtAgo(r.latest?.last_data_at ?? null)}</div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-neutral-700">{r.latest?.minutes_lag != null ? `${Math.round(r.latest.minutes_lag)}m` : "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-neutral-500">{r.latest?.expected_min ?? "?"}m</td>
                    <td className="px-4 py-3"><Sparkline points={r.lagPoints} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-neutral-400">
            Snapshot count (24h): {snapshots.length}. Cron: <code>data_health_snapshot_15min</code> at :08/:23/:38/:53.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">Recent alerts (24h)</h2>
          {alerts.length === 0 ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              No alerts in the last 24 hours. All sources reporting within expected windows.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white text-sm shadow-sm">
              {alerts.map((a, i) => (
                <li key={`${a.source}-${a.snapshot_at}-${i}`} className="flex items-baseline justify-between px-4 py-2.5">
                  <span>
                    <span className="mr-2 font-medium text-neutral-900">{a.source}</span>
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${stateClasses(a.state)}`}>{a.state}</span>
                  </span>
                  <span className="text-xs text-neutral-500 tabular-nums">
                    {fmtChi(a.snapshot_at)} ({a.minutes_lag != null ? `${Math.round(a.minutes_lag)}m lag` : "—"})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  );
}

