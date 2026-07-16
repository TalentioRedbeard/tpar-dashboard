// Customers list. Sources from customer_360. Search by name. Pagination via
// ?page=N. Each row links to /customer/[id] for the existing 360 view.

import { redirect } from "next/navigation";
import { db } from "../../lib/supabase";
import { getCurrentTech } from "../../lib/current-tech";
import { PageShell } from "../../components/PageShell";
import { Table, Pagination, FilterBar, fmtMoney, fmtDateShort, type Column } from "../../components/Table";
import { StatCard } from "../../components/ui/StatCard";
import { TechCustomersView } from "./TechCustomersView";

export const metadata = { title: "Customers · TPAR-DB" };

const PAGE_SIZE = 50;

type CustomerRow = {
  hcp_customer_id: string;
  name: string | null;
  phone10: string | null;
  phone_mobile10: string | null;
  lifetime_job_count: number | null;
  lifetime_paid_revenue_dollars: number | null;
  outstanding_due_dollars: number | null;
  comm_count_90d: number | null;
  open_followups: number | null;
  most_recent_comm: string | null;
  member_count?: number | null; // entity search: how many HCP records this customer spans
};

type EntityRow = {
  hcp_customer_id: string;
  display_name: string | null;
  member_count: number;
  lifetime_revenue: number;
  outstanding: number;
  job_count: number;
  comm_count_90d: number;
  open_followups: number;
  last_contact: string | null;
};
const INTERNAL_NAMES = ["Tulsa Plumbing and Remodeling", "TPAR", "Spam", "DMG", "System"];

export default async function CustomersListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; outstanding?: string; include_internal?: string }>;
}) {
  // Customer list exposes lifetime revenue + outstanding AR + PII for every
  // customer. Gate to admin/manager; techs reach their own jobs' customers
  // via scoped /customer/[id].
  const me = await getCurrentTech().catch(() => null);
  // Techs get their own scheduled customers (contact info, financials redacted)
  // instead of the company list; office users (no tech row) still go to /me.
  if (!me?.isAdmin && !me?.isManager) {
    if (me?.tech) {
      return <TechCustomersView hcpEmployeeId={me.tech.hcp_employee_id} shortName={me.tech.tech_short_name} />;
    }
    redirect("/me");
  }
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const page = Math.max(1, Number(params.page ?? "1"));
  const outstandingOnly = params.outstanding === "1";
  const includeInternal = params.include_internal === "1";

  const supa = db();
  const searching = q.length >= 2;

  let rows: CustomerRow[] = [];
  let count: number | null = null;
  let totalLifetime = 0, totalOutstanding = 0, customersWithOpenFollowups = 0, statsN = 0;

  if (searching) {
    // Entity-tethered search (P4.1, 2026-06-18): one row per real customer ENTITY —
    // fragmented HCP records folded together via shared Company/phone/email — with
    // aggregates summed across members + full-roster recall (NULL-name records included).
    // e.g. "Brad Dunlap" => 1 row, 25 records, ~$243k lifetime, not 25 scattered rows / a miss.
    const { data: ents } = await supa.rpc("search_customer_entities", { q, lim: 100 });
    let erows = (ents ?? []) as EntityRow[];
    if (outstandingOnly) erows = erows.filter((e) => Number(e.outstanding) > 0);
    if (!includeInternal) erows = erows.filter((e) => !INTERNAL_NAMES.includes(e.display_name ?? ""));
    rows = erows.map((e) => ({
      hcp_customer_id: e.hcp_customer_id,
      name: e.display_name,
      phone10: null,
      phone_mobile10: null,
      lifetime_job_count: e.job_count,
      lifetime_paid_revenue_dollars: e.lifetime_revenue,
      outstanding_due_dollars: e.outstanding,
      comm_count_90d: e.comm_count_90d,
      open_followups: e.open_followups,
      most_recent_comm: e.last_contact,
      member_count: e.member_count,
    }));
    count = rows.length;
    totalLifetime = rows.reduce((s, r) => s + (Number(r.lifetime_paid_revenue_dollars) || 0), 0);
    totalOutstanding = rows.reduce((s, r) => s + (Number(r.outstanding_due_dollars) || 0), 0);
    customersWithOpenFollowups = rows.filter((r) => Number(r.open_followups) > 0).length;
    statsN = rows.length;
  } else {
    let query = supa
      .from("customer_360")
      .select(
        "hcp_customer_id, name, phone10, phone_mobile10, lifetime_job_count, lifetime_paid_revenue_dollars, outstanding_due_dollars, comm_count_90d, open_followups, most_recent_comm",
        { count: "exact" }
      );
    if (outstandingOnly) query = query.gt("outstanding_due_dollars", 0);
    // Hide internal/noise rows by default. Same filter pattern as /jobs + recurring-jobs view.
    if (!includeInternal) query = query.not("name", "in", '("Tulsa Plumbing and Remodeling","TPAR","Spam","DMG","System")');
    const res = await query
      .order("most_recent_comm", { ascending: false, nullsFirst: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    rows = (res.data ?? []) as CustomerRow[];
    count = res.count ?? null;

    // Stat strip — same filter window, capped at 500.
    let statsQuery = supa
      .from("customer_360")
      .select("lifetime_paid_revenue_dollars, outstanding_due_dollars, open_followups, lifetime_job_count")
      .order("most_recent_comm", { ascending: false, nullsFirst: false })
      .limit(500);
    if (outstandingOnly) statsQuery = statsQuery.gt("outstanding_due_dollars", 0);
    if (!includeInternal) statsQuery = statsQuery.not("name", "in", '("Tulsa Plumbing and Remodeling","TPAR","Spam","DMG","System")');
    const { data: statsRows } = await statsQuery;
    const stats = (statsRows ?? []) as Array<{ lifetime_paid_revenue_dollars: number | null; outstanding_due_dollars: number | null; open_followups: number | null; lifetime_job_count: number | null }>;
    totalLifetime = stats.reduce((s, r) => s + (Number(r.lifetime_paid_revenue_dollars) || 0), 0);
    totalOutstanding = stats.reduce((s, r) => s + (Number(r.outstanding_due_dollars) || 0), 0);
    customersWithOpenFollowups = stats.filter((r) => Number(r.open_followups) > 0).length;
    statsN = stats.length;
  }
  const avgLifetime = statsN > 0 ? totalLifetime / statsN : 0;

  const columns: Column<CustomerRow>[] = [
    {
      header: "Name",
      cell: (r) =>
        r.member_count && r.member_count > 1 ? (
          <span>
            {r.name ?? "—"} <span className="text-xs font-normal text-neutral-400">· {r.member_count} records</span>
          </span>
        ) : (
          r.name ?? "—"
        ),
      className: "font-medium text-neutral-900",
    },
    { header: "Jobs", cell: (r) => r.lifetime_job_count ?? 0, align: "right" },
    { header: "Lifetime", cell: (r) => fmtMoney(r.lifetime_paid_revenue_dollars), align: "right" },
    {
      header: "Outstanding",
      cell: (r) =>
        Number(r.outstanding_due_dollars) > 0 ? (
          <span className="font-medium text-red-700">{fmtMoney(r.outstanding_due_dollars)}</span>
        ) : (
          <span className="text-neutral-400">—</span>
        ),
      align: "right",
    },
    { header: "Comms 90d", cell: (r) => r.comm_count_90d ?? 0, align: "right" },
    {
      header: "Open follow-ups",
      cell: (r) =>
        Number(r.open_followups) > 0 ? (
          <span className="font-medium text-amber-700">{r.open_followups}</span>
        ) : (
          <span className="text-neutral-400">0</span>
        ),
      align: "right",
    },
    { header: "Last contact", cell: (r) => fmtDateShort(r.most_recent_comm), align: "right" },
  ];

  const baseHref = `/customers?${new URLSearchParams({
    ...(q ? { q } : {}),
    ...(outstandingOnly ? { outstanding: "1" } : {}),
    ...(includeInternal ? { include_internal: "1" } : {}),
  }).toString()}`;

  return (
    <PageShell
      icon="👥"
      title="Customers"
      description="Search, filter, and pivot the full customer roster."
    >
      <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={searching ? "Entities matched" : "Customers (window)"} value={(count ?? 0).toLocaleString()} hint={searching ? "fragmented records folded" : statsN === 500 ? "stats: top 500" : `stats: all ${statsN}`} />
        <StatCard label="Avg lifetime" value={fmtMoney(avgLifetime)} tone={avgLifetime > 5000 ? "brand" : "neutral"} />
        <StatCard label="Total outstanding" value={fmtMoney(totalOutstanding)} tone={totalOutstanding > 0 ? "red" : "neutral"} />
        <StatCard label="Open follow-ups" value={customersWithOpenFollowups.toLocaleString()} tone={customersWithOpenFollowups > 0 ? "amber" : "neutral"} hint="customers with ≥1 open" />
      </section>

      <FilterBar>
        <label className="block">
          <span className="block text-xs font-medium text-neutral-600">Search by name</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="e.g. Petrovich"
            className="mt-1 w-64 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <label className="inline-flex items-center gap-2 pb-1.5">
          <input type="checkbox" name="outstanding" value="1" defaultChecked={outstandingOnly} />
          <span className="text-sm text-neutral-600">Outstanding balance only</span>
        </label>
        <label className="inline-flex items-center gap-2 pb-1.5">
          <input type="checkbox" name="include_internal" value="1" defaultChecked={includeInternal} />
          <span className="text-sm text-neutral-600">Include TPAR-internal</span>
        </label>
        <button
          type="submit"
          className="ml-auto rounded-md bg-brand-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
        >
          Apply
        </button>
      </FilterBar>

      <Table
        columns={columns}
        rows={rows}
        rowHref={(r) => (r.hcp_customer_id ? `/customer/${r.hcp_customer_id}` : null)}
        emptyText={q ? `No customers matched "${q}".` : "No customers found."}
      />
      {searching ? (
        <p className="mt-3 text-xs text-neutral-400">Search folds a customer&apos;s fragmented HCP records into one entity (shared company, phone, or email) — figures are summed across all of them. Clear the search for the full paginated roster.</p>
      ) : (
        <Pagination page={page} pageSize={PAGE_SIZE} totalCount={count ?? null} baseHref={baseHref.replace(/[?&]page=\d+/, "")} />
      )}
    </PageShell>
  );
}
