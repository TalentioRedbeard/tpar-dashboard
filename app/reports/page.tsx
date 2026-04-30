import Link from "next/link";
import { PageShell } from "../../components/PageShell";

export const metadata = { title: "Reports · TPAR-DB" };

const REPORTS = [
  { href: "/reports/ar",       title: "Receivables", desc: "Aging buckets, collection priorities, days-outstanding leaderboard." },
  { href: "/reports/margin",   title: "Margin",      desc: "Per-job and per-tech profitability, revenue-weighted across cost-validated jobs." },
  { href: "/reports/tech",     title: "Tech KPIs",   desc: "On-time, hours, revenue, customer ratings per technician." },
  { href: "/reports/patterns", title: "Patterns",    desc: "Customers showing recurring themes — preventative-agreement candidates." },
  { href: "/reports/audit",    title: "Audit (values-gate)", desc: "Auto-approval log for development-side decisions. What the system has been deciding on its own, with the values reasoning preserved." },
  { href: "/reports/notes",    title: "Notes feed",          desc: "Recent operator notes added across customers and jobs. Filter by author + window. Pure read." },
];

export default function ReportsIndexPage() {
  return (
    <PageShell title="Reports" description="Operational + financial views of the substrate.">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {REPORTS.map((r) => (
          <li key={r.href}>
            <Link
              href={r.href}
              className="block rounded-2xl border border-neutral-200 bg-white p-5 transition hover:border-neutral-400 hover:shadow-sm"
            >
              <h3 className="text-base font-semibold text-neutral-900">{r.title}</h3>
              <p className="mt-1 text-sm text-neutral-600">{r.desc}</p>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
