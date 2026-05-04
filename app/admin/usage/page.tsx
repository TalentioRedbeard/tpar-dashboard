// /admin/usage — who is using the dashboard, how often, where.
//
// Carry-forward #133 from Danny 2026-05-04: "Can you review the website
// usage by Kelsey and Madisson?" Page-views land in dashboard_page_views
// from middleware on every authenticated request; this page rolls them up.

import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  getUserSummary,
  getPathLeaderboard,
  getUserPathBreakdown,
} from "./actions";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 7;

function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function fmtAbs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function UsagePage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/admin/usage");
  if (!me.isAdmin && !me.isManager) {
    return (
      <PageShell title="Admin only" description="Usage analytics is for leadership.">
        <EmptyState title="Not authorized." />
      </PageShell>
    );
  }

  const [users, paths, breakdown] = await Promise.all([
    getUserSummary(WINDOW_DAYS),
    getPathLeaderboard(WINDOW_DAYS),
    getUserPathBreakdown(WINDOW_DAYS),
  ]);

  const totalViews = users.reduce((acc, u) => acc + u.total_views, 0);
  const distinctUsers = users.length;
  const distinctPaths = paths.length;

  return (
    <PageShell
      kicker="Admin · Usage"
      title="Dashboard usage"
      description={
        <span>
          Last {WINDOW_DAYS} days of authenticated page views. Rolled up from{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">
            dashboard_page_views
          </code>{" "}
          (middleware-logged on every page hit). Path IDs are normalized so{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">/job/12345</code>{" "}
          rolls up with{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">/job/67890</code>.
        </span>
      }
    >
      {totalViews === 0 ? (
        <EmptyState
          title="No page views logged yet."
          description={
            <>
              The middleware logs each page hit going forward; this view fills in as the
              team uses the dashboard. If this is unexpected,{" "}
              <code className="rounded bg-neutral-100 px-1 font-mono">SUPABASE_SERVICE_ROLE_KEY</code>{" "}
              may be missing from the deployed env.
            </>
          }
        />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Total views" value={totalViews} />
            <Stat label="Distinct users" value={distinctUsers} />
            <Stat label="Distinct paths" value={distinctPaths} />
          </div>

          <Section
            title="By user"
            description="Sorted by view count. Names from tech_directory; unmatched emails appear as raw addresses."
          >
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium text-neutral-600">User</th>
                    <th className="px-4 py-2 font-medium text-neutral-600">Role</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Views</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Days active</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Distinct paths</th>
                    <th className="px-4 py-2 font-medium text-neutral-600">First seen</th>
                    <th className="px-4 py-2 font-medium text-neutral-600">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {users.map((u) => (
                    <tr key={u.user_email} className="hover:bg-neutral-50">
                      <td className="px-4 py-2">
                        <div className="font-medium text-neutral-900">
                          {u.display_name ?? u.user_email}
                        </div>
                        {u.display_name ? (
                          <div className="text-xs text-neutral-500">{u.user_email}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">
                        <RoleBadge role={u.dashboard_role} />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{u.total_views}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {u.distinct_days} / {WINDOW_DAYS}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{u.distinct_paths}</td>
                      <td className="px-4 py-2 text-xs text-neutral-600" title={u.first_seen}>
                        {fmtAbs(u.first_seen)}
                      </td>
                      <td className="px-4 py-2 text-xs text-neutral-600" title={u.last_seen}>
                        {fmtRel(u.last_seen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="my-6" />

          <Section
            title="Top paths"
            description="Most-hit pages over the window."
          >
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium text-neutral-600">Path</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Views</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Distinct users</th>
                    <th className="px-4 py-2 font-medium text-neutral-600">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {paths.slice(0, 30).map((p) => (
                    <tr key={p.path} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 font-mono text-xs text-brand-700">{p.path}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{p.views}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{p.distinct_users}</td>
                      <td className="px-4 py-2 text-xs text-neutral-600">{fmtRel(p.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="my-6" />

          <Section
            title="By user × path (top 5 paths each)"
            description="What each person actually opens."
          >
            <div className="space-y-4">
              {users.map((u) => {
                const userTop = breakdown
                  .filter((b) => b.user_email === u.user_email)
                  .slice(0, 5);
                if (userTop.length === 0) return null;
                return (
                  <div
                    key={u.user_email}
                    className="rounded-2xl border border-neutral-200 bg-white p-4"
                  >
                    <div className="mb-2 flex items-baseline justify-between">
                      <div>
                        <span className="font-medium text-neutral-900">
                          {u.display_name ?? u.user_email}
                        </span>
                        <span className="ml-2 text-xs text-neutral-500">
                          {u.total_views} views · {u.distinct_days}/{WINDOW_DAYS} days
                        </span>
                      </div>
                      <RoleBadge role={u.dashboard_role} />
                    </div>
                    <ul className="space-y-1 text-sm">
                      {userTop.map((b) => (
                        <li
                          key={b.path}
                          className="flex items-center justify-between rounded-md bg-neutral-50 px-3 py-1.5"
                        >
                          <code className="font-mono text-xs text-brand-700">{b.path}</code>
                          <span className="text-xs text-neutral-600">
                            <span className="tabular-nums">{b.views}</span> · last {fmtRel(b.last_seen)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Section>
        </>
      )}

      <footer className="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-500">
        Logging began with migration 20260504040000. Earlier sessions aren&apos;t captured.
      </footer>
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-neutral-900">
        {value}
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return <span className="text-xs text-neutral-400">—</span>;
  const tone =
    role === "admin"
      ? "bg-brand-100 text-brand-800"
      : role === "manager" || role === "production_manager"
      ? "bg-emerald-100 text-emerald-800"
      : role === "tech"
      ? "bg-neutral-100 text-neutral-700"
      : "bg-neutral-100 text-neutral-500";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
      {role}
    </span>
  );
}
