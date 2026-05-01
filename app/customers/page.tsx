// Customers list. Sources from customer_360. Search by name. Pagination via
// ?page=N. Each row links to /customer/[id] for the existing 360 view.

import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { Table, Pagination, FilterBar, fmtMoney, fmtDateShort, type Column } from "../../components/Table";

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
};

export default async function CustomersListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; outstanding?: string; include_internal?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const page = Math.max(1, Number(params.page ?? "1"));
  const outstandingOnly = params.outstanding === "1";
  const includeInternal = params.include_internal === "1";

  const supa = db();
  let query = supa
    .from("customer_360")
    .select(
      "hcp_customer_id, name, phone10, phone_mobile10, lifetime_job_count, lifetime_paid_revenue_dollars, outstanding_due_dollars, comm_count_90d, open_followups, most_recent_comm",
      { count: "exact" }
    );
  if (q) query = query.ilike("name", `%${q}%`);
  if (outstandingOnly) query = query.gt("outstanding_due_dollars", 0);
  // Hide internal/noise rows by default. Same filter pattern as /jobs +
  // the recurring-jobs view.
  if (!includeInternal) {
    query = query.not("name", "in", '("Tulsa Plumbing and Remodeling","TPAR","Spam","DMG","System")');
  }

  const { data, count } = await query
    .order("most_recent_comm", { ascending: false, nullsFirst: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = (data ?? []) as CustomerRow[];

  const columns: Column<CustomerRow>[] = [
    { header: "Name", cell: (r) => r.name ?? "—", className: "font-medium text-neutral-900" },
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
      title="Customers"
      description="Search, filter, and pivot the full customer roster."
    >
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
      <Pagination page={page} pageSize={PAGE_SIZE} totalCount={count ?? null} baseHref={baseHref.replace(/[?&]page=\d+/, "")} />
    </PageShell>
  );
}
