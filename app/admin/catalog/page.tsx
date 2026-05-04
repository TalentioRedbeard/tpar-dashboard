// /admin/catalog — auto-generated index of every system surface.
// Per Danny 2026-05-04 (#121). Dashboard pages + MCP tools curated; edge
// functions auto-discovered from maintenance_logs (last 7 days); crons +
// Slack commands TBD (separate datasources).

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  getActiveEdgeFns,
  DASHBOARD_PAGES,
  MCP_TOOLS,
} from "./actions";

export const dynamic = "force-dynamic";

function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default async function CatalogPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/admin/catalog");
  if (!me.isAdmin && !me.isManager) {
    return (
      <PageShell title="Admin only" description="Catalog is for leadership.">
        <EmptyState title="Not authorized." />
      </PageShell>
    );
  }

  const activeEdgeFns = await getActiveEdgeFns();

  // Filter by surface for the pages section
  const adminPages = DASHBOARD_PAGES.filter((p) => p.surface === "admin");
  const managerPages = DASHBOARD_PAGES.filter((p) => p.surface === "manager");
  const techPages = DASHBOARD_PAGES.filter((p) => p.surface === "tech");
  const allPages = DASHBOARD_PAGES.filter((p) => p.surface === "all");

  const tparTools = MCP_TOOLS.filter((t) => t.category === "tpar");
  const browserTools = MCP_TOOLS.filter((t) => t.category === "browser");

  return (
    <PageShell
      kicker="Admin · Catalog"
      title="System surface index"
      description={
        <span>
          Every dashboard page, MCP tool, and active edge function. Pages + MCP
          tools are curated; edge functions auto-discovered from the last 7
          days of maintenance logs.
        </span>
      }
    >
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Dashboard pages" value={DASHBOARD_PAGES.length} />
        <Stat label="MCP tools" value={MCP_TOOLS.length} />
        <Stat label="Active edge fns (7d)" value={activeEdgeFns.length} />
      </div>

      <Section
        title="Dashboard pages"
        description={`${DASHBOARD_PAGES.length} surfaces. Curated; update lib/feature-catalog when adding pages.`}
      >
        <div className="space-y-5">
          <PageGroup title="All roles" items={allPages} />
          <PageGroup title="Tech-only" items={techPages} />
          <PageGroup title="Manager + Admin" items={managerPages} />
          <PageGroup title="Admin-only" items={adminPages} />
        </div>
      </Section>

      <div className="my-6" />

      <Section
        title="MCP tools"
        description={`${MCP_TOOLS.length} tools exposed via mcp-tpar. Connect via Claude.ai Custom Connectors.`}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">TPAR data</div>
            <ul className="space-y-1 text-sm">
              {tparTools.map((t) => (
                <li key={t.name} className="rounded-md border border-neutral-200 bg-white px-3 py-2">
                  <code className="font-mono text-xs text-brand-700">{t.name}</code>
                  <span className="ml-2 text-neutral-600">{t.description}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Browser automation</div>
            <ul className="space-y-1 text-sm">
              {browserTools.map((t) => (
                <li key={t.name} className="rounded-md border border-neutral-200 bg-white px-3 py-2">
                  <code className="font-mono text-xs text-brand-700">{t.name}</code>
                  <span className="ml-2 text-neutral-600">{t.description}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <div className="my-6" />

      <Section
        title="Active edge functions"
        description={`Auto-discovered from maintenance_logs (last 7 days). ${activeEdgeFns.length} fns logged activity. Functions that don't log won't appear here.`}
      >
        {activeEdgeFns.length === 0 ? (
          <EmptyState title="No edge fn activity logged in last 7 days." />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Source</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">Logs (7d)</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Last seen</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Last level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {activeEdgeFns.map((fn) => (
                  <tr key={fn.source} className="hover:bg-neutral-50">
                    <td className="px-4 py-2 font-mono text-xs text-neutral-800">{fn.source}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{fn.recent_24h}</td>
                    <td className="px-4 py-2 text-xs text-neutral-600">{fmtRel(fn.last_seen)}</td>
                    <td className="px-4 py-2">
                      <span className={
                        fn.last_level === "error" || fn.last_level === "critical"
                          ? "inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
                          : fn.last_level === "warn"
                          ? "inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                          : "inline-block rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600"
                      }>
                        {fn.last_level ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="my-6" />

      <Section
        title="Crons + Slack commands"
        description="Live data sources — query directly when needed."
      >
        <ul className="space-y-1 text-sm">
          <li>
            <strong>Cron jobs:</strong> query <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">cron.job</code> via psql (run-sql.sh -c "SELECT jobid, jobname, schedule, active FROM cron.job") — currently 30+ scheduled.
          </li>
          <li>
            <strong>Slack commands:</strong> 16 registered on the TPAR-DB Slack app. List via <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">/admin/view-as → /need /receipt /price /describe /ask /estimate-draft</code> + others. Edit via slack-manifest-edit edge fn.
          </li>
          <li>
            <strong>Database tables/views:</strong> queryable via <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">information_schema</code>; see <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">scripts/regenerate-db-dictionary.sh</code> for full audit.
          </li>
        </ul>
      </Section>

      <footer className="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-500">
        Catalog generated {new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })}.
        Update <code className="font-mono">app/admin/catalog/actions.ts</code> when adding a page or MCP tool.
      </footer>
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-neutral-900">{value}</div>
    </div>
  );
}

function PageGroup({
  title,
  items,
}: {
  title: string;
  items: typeof DASHBOARD_PAGES;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</div>
      <ul className="space-y-1.5 text-sm">
        {items.map((p) => (
          <li key={p.path} className="rounded-md border border-neutral-200 bg-white px-3 py-2">
            <Link href={p.path.replace(/\[.*?\]/g, "")} className="font-mono text-xs text-brand-700 hover:underline">
              {p.path}
            </Link>
            <span className="ml-2 text-neutral-700">{p.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
