// Jobs list. Sources from job_360. Filter by status / tech / outstanding /
// date range. Pagination via ?page=N. Each row links to /job/[id].
//
// "Mine only" = filter to the signed-in tech (admins can ?as=Anthony to
// view another tech's lane). Resolved via getEffectiveTechName.

import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { Table, Pagination, FilterBar, fmtMoney, fmtPct, fmtDateShort, type Column } from "../../components/Table";
import { getEffectiveTechName } from "../../lib/current-tech";

export const metadata = { title: "Jobs · TPAR-DB" };

const PAGE_SIZE = 50;

type JobRow = {
  hcp_job_id: string;
  hcp_customer_id: string | null;
  customer_name: string | null;
  invoice_number: string | null;
  job_date: string | null;
  tech_primary_name: string | null;
  appointment_status: string | null;
  revenue: number | null;
  due_amount: number | null;
  days_outstanding: number | null;
  gross_margin_pct: number | null;
  on_time: boolean | null;
  gps_matched: boolean | null;
};

export default async function JobsListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tech?: string; status?: string; outstanding?: string; include_internal?: string; mine?: string; as?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const tech = (params.tech ?? "").trim();
  const status = (params.status ?? "").trim();
  const outstandingOnly = params.outstanding === "1";
  const includeInternal = params.include_internal === "1";
  const mineOnly = params.mine === "1";
  const asOverride = (params.as ?? "").trim() || null;
  const page = Math.max(1, Number(params.page ?? "1"));

  // Resolve "mine" to the signed-in tech's name (admins can override via ?as=).
  const effective = mineOnly ? await getEffectiveTechName(asOverride) : null;
  const effectiveTechName = effective?.techName ?? null;

  const supa = db();
  let query = supa
    .from("job_360")
    .select(
      "hcp_job_id, hcp_customer_id, customer_name, invoice_number, job_date, tech_primary_name, appointment_status, revenue, due_amount, days_outstanding, gross_margin_pct, on_time, gps_matched",
      { count: "exact" }
    );
  if (q)      query = query.or(`customer_name.ilike.%${q}%,invoice_number.ilike.%${q}%`);
  // "mine" filter takes precedence over the dropdown tech filter.
  if (effectiveTechName) query = query.eq("tech_primary_name", effectiveTechName);
  else if (tech) query = query.eq("tech_primary_name", tech);
  if (status) query = query.eq("appointment_status", status);
  if (outstandingOnly) query = query.gt("due_amount", 0);
  // Hide internal "TPAR" jobs by default — these are estimate-drafts, not
  // customer work. Same filter the recurring-jobs view applies.
  if (!includeInternal) {
    query = query.not("customer_name", "in", '("Tulsa Plumbing and Remodeling","TPAR","Spam","DMG","System")');
  }

  const { data, count } = await query
    .order("job_date", { ascending: false, nullsFirst: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = (data ?? []) as JobRow[];

  // Tech list from tech_directory — authoritative, no scan-and-distinct hack.
  const { data: techData } = await supa
    .from("tech_directory")
    .select("hcp_full_name")
    .eq("is_active", true)
    .order("hcp_full_name", { ascending: true });
  const techNames = (techData ?? [])
    .map((r: { hcp_full_name: string | null }) => r.hcp_full_name)
    .filter((n): n is string => Boolean(n));

  const columns: Column<JobRow>[] = [
    { header: "Date", cell: (r) => fmtDateShort(r.job_date), className: "text-neutral-600" },
    { header: "Invoice", cell: (r) => r.invoice_number ?? "—", className: "font-mono text-xs" },
    { header: "Customer", cell: (r) => r.customer_name ?? "—", className: "font-medium text-neutral-900" },
    { header: "Tech", cell: (r) => r.tech_primary_name ?? "—" },
    { header: "Status", cell: (r) => r.appointment_status ?? "—", className: "text-neutral-600" },
    { header: "Revenue", cell: (r) => fmtMoney(r.revenue), align: "right" },
    {
      header: "Margin",
      cell: (r) =>
        r.gross_margin_pct != null && Number(r.gross_margin_pct) < 100 ? (
          <span>{fmtPct(r.gross_margin_pct)}</span>
        ) : (
          <span className="text-neutral-400">—</span>
        ),
      align: "right",
    },
    {
      header: "Due",
      cell: (r) =>
        Number(r.due_amount) > 0 ? (
          <span className="font-medium text-red-700">
            {fmtMoney(r.due_amount)} · {r.days_outstanding ?? "?"}d
          </span>
        ) : (
          <span className="text-neutral-400">paid</span>
        ),
      align: "right",
    },
    {
      header: "GPS",
      cell: (r) =>
        r.gps_matched ? (r.on_time === true ? "✓ on-time" : r.on_time === false ? "late" : "—") : <span className="text-neutral-400">—</span>,
      className: "text-xs",
    },
  ];

  const sharedFilters = {
    ...(q ? { q } : {}),
    ...(tech && !mineOnly ? { tech } : {}),
    ...(status ? { status } : {}),
    ...(outstandingOnly ? { outstanding: "1" } : {}),
    ...(includeInternal ? { include_internal: "1" } : {}),
    ...(mineOnly ? { mine: "1" } : {}),
    ...(asOverride ? { as: asOverride } : {}),
  };
  const baseHref = `/jobs?${new URLSearchParams(sharedFilters).toString()}`;
  const csvHref = `/jobs/export.csv?${new URLSearchParams(sharedFilters).toString()}`;

  const description = effectiveTechName
    ? `Jobs where ${effectiveTechName} is the primary tech.`
    : "Active and recent jobs across the team.";

  return (
    <PageShell
      title="Jobs"
      description={description}
      actions={
        <a
          href={csvHref}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Download CSV
        </a>
      }
    >
      <FilterBar>
        {effective ? <input type="hidden" name="mine" value="1" /> : null}
        {asOverride ? <input type="hidden" name="as" value={asOverride} /> : null}
        <label className="block">
          <span className="block text-xs font-medium text-neutral-600">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="customer or invoice"
            className="mt-1 w-56 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-neutral-600">Tech</span>
          <select name="tech" defaultValue={tech} className="mt-1 w-40 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm">
            <option value="">All techs</option>
            {techNames.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-neutral-600">Status</span>
          <select name="status" defaultValue={status} className="mt-1 w-40 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm">
            <option value="">Any</option>
            <option value="scheduled">scheduled</option>
            <option value="in progress">in progress</option>
            <option value="complete rated">complete rated</option>
            <option value="complete unrated">complete unrated</option>
            <option value="canceled">canceled</option>
          </select>
        </label>
        {effective ? (
          <span className="inline-flex items-center gap-2 self-end pb-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
            Mine only{effective.viewingAs ? ` · ${effective.viewingAs}` : ""}
            <a href={`/jobs?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...(outstandingOnly ? { outstanding: "1" } : {}), ...(includeInternal ? { include_internal: "1" } : {}) }).toString()}`} className="ml-1 text-emerald-700 hover:text-emerald-900" aria-label="Clear mine filter">×</a>
          </span>
        ) : null}
        <label className="inline-flex items-center gap-2 pb-1.5">
          <input type="checkbox" name="outstanding" value="1" defaultChecked={outstandingOnly} />
          <span className="text-sm text-neutral-600">Outstanding only</span>
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
        rowHref={(r) => (r.hcp_job_id ? `/job/${r.hcp_job_id}` : null)}
        emptyText="No jobs match those filters."
      />
      <Pagination page={page} pageSize={PAGE_SIZE} totalCount={count ?? null} baseHref={baseHref} />
    </PageShell>
  );
}
