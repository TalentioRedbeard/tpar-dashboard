import Link from "next/link";
import { redirect } from "next/navigation";
import { PageShell } from "../../components/PageShell";
import { getCurrentTech } from "../../lib/current-tech";

export const metadata = { title: "Reports · TPAR-DB" };

const REPORTS = [
  { href: "/reports/ar",       title: "Receivables", desc: "Aging buckets, collection priorities, days-outstanding leaderboard." },
  { href: "/reports/margin",   title: "Margin",      desc: "Per-job and per-tech profitability, revenue-weighted across cost-validated jobs." },
  { href: "/reports/tech",     title: "Tech KPIs",   desc: "On-time, hours, revenue, customer ratings per technician." },
  { href: "/reports/patterns", title: "Patterns",    desc: "Customers showing recurring themes — preventative-agreement candidates." },
  { href: "/reports/pip",      title: "PIP report",  desc: "Process / Product / Performance signals across the last 30 days of comm-event traffic." },
  { href: "/reports/agreements", title: "Maintenance agreements", desc: "Preventative-cadence agreements per customer. Decision capture today; auto-scheduling in v1." },
  { href: "/reports/material-spend", title: "Vendor spend & receipts", desc: "The whole receipt picture — total captured, top vendors, 12-week trend, and the live recent-receipts feed. $573k across 1,514 receipts." },
  { href: "/reports/receipts", title: "Receipt reconciliation", desc: "Attribute unattributed receipts (~$431k of material spend) to jobs so cost lands in margin — or mark overhead. Auto-suggests by tech + date." },
  { href: "/reports/vehicles", title: "Fleet vehicles", desc: "TPAR fleet catalog with estimated odometer (Bouncie + last-known reading) and service history. v1: owner's-manual-driven service alerts." },
  { href: "/reports/audit",    title: "Audit (values-gate)", desc: "Auto-approval log for development-side decisions. What the system has been deciding on its own, with the values reasoning preserved." },
  { href: "/reports/notes",    title: "Notes feed",          desc: "Recent operator notes added across customers and jobs. Filter by author + window. Pure read." },
];

export default async function ReportsIndexPage() {
  // Company-wide financials (margin, AR, per-tech revenue) — leadership only.
  // Techs are scoped to their own work on /me, so bounce them here too (the
  // nav link is already hidden). Matches /jobs, /customers, /schedule, etc.
  const me = await getCurrentTech().catch(() => null);
  if (!me?.isAdmin && !me?.isManager) redirect("/me");
  return (
    <PageShell title="Reports" description="Operational + financial views of the substrate.">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {REPORTS.map((r) => (
          <li key={r.href}>
            <Link
              href={r.href}
              className="group block rounded-2xl border border-neutral-200 bg-white p-5 transition-all duration-150 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md"
            >
              <h3 className="text-base font-semibold tracking-tight text-neutral-900 transition-colors group-hover:text-brand-700">{r.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-neutral-600">{r.desc}</p>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
