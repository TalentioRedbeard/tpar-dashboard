// Jobs list. Sources from job_360. Filter by status / tech / outstanding /
// date range. Pagination via ?page=N. Each row links to /job/[id].
//
// "Mine only" = filter to the signed-in tech (admins can ?as=Anthony to
// view another tech's lane). Resolved via getEffectiveTechName.
//
// HCP estimate fallback: if the search query is an all-digit string and
// our DB returns 0 hits, we ask the resolve-hcp-estimate edge function
// to live-look-up HCP and redirect to the matching job (typically the
// most recent job for the estimate's customer). Closes the gap where
// estimates created in HCP's Pro UI aren't synced to our DB.

import { redirect } from "next/navigation";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { AppGuide } from "../../components/AppGuide";
import { Table, Pagination, FilterBar, StatusPill, fmtMoney, fmtPct, fmtDateShort, type Column } from "../../components/Table";
import { StatCard } from "../../components/ui/StatCard";
import { getEffectiveTechName } from "../../lib/current-tech";
import { getFormerTechNames } from "../../lib/former-techs";
import { TechName } from "../../components/ui/TechName";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

async function liveLookupHcpEstimate(estimateNumber: string): Promise<{ hcp_job_id: string | null; hcp_customer_id: string | null; customer_name: string | null } | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/resolve-hcp-estimate`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ estimate_number: estimateNumber }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data?.ok) return null;
    return {
      hcp_job_id: data.hcp_job_id ?? null,
      hcp_customer_id: data.hcp_customer_id ?? null,
      customer_name: data.customer_name ?? null,
    };
  } catch {
    return null;
  }
}

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
  // job_360.tech_primary_name and tech_all_names both use HCP full names.
  // We filter on either: tech is the (currently-mislabeled) primary OR is in
  // the assigned crew. Helpers see their own work; leads still see theirs.
  // The "mislabeled primary" thing is a known issue — see project memory
  // 'lead-vs-helper signal' — tech_primary_name = HCP assigned_employees[0]
  // which sorts first-name alphabetically, not by role.
  const effective = mineOnly ? await getEffectiveTechName(asOverride) : null;
  const effectiveTechName = effective?.fullName ?? null;

  const supa = db();
  let query = supa
    .from("job_360")
    .select(
      "hcp_job_id, hcp_customer_id, customer_name, invoice_number, job_date, tech_primary_name, appointment_status, revenue, due_amount, days_outstanding, gross_margin_pct, on_time, gps_matched",
      { count: "exact" }
    );
  // Search across customer name, invoice number, AND hcp_estimate_number so
  // a user can paste the number off any HCP page (estimate or invoice) and
  // find the job. NB: hcp_estimate_number only populates for estimates we
  // pushed via Tool 3; pure-HCP estimates won't be found this way (they
  // require the customer-name fallback or, eventually, a live HCP lookup).
  if (q)      query = query.or(`customer_name.ilike.%${q}%,invoice_number.ilike.%${q}%,hcp_estimate_number.ilike.%${q}%`);
  // "mine" filter takes precedence over the dropdown tech filter. Match on
  // either primary OR in tech_all_names so helpers see jobs they worked on.
  if (effectiveTechName) {
    query = query.or(`tech_primary_name.eq."${effectiveTechName}",tech_all_names.cs.{"${effectiveTechName}"}`);
  } else if (tech) {
    query = query.eq("tech_primary_name", tech);
  }
  if (status) query = query.eq("appointment_status", status);
  if (outstandingOnly) query = query.gt("due_amount", 0);
  // Hide internal "TPAR" jobs by default — these are estimate-drafts, not
  // customer work. Same filter the recurring-jobs view applies.
  if (!includeInternal) {
    query = query.not("customer_name", "in", '("Tulsa Plumbing and Remodeling","TPAR","Spam","DMG","System")');
    // Also exclude test-customer rows (Danny-as-customer test artifacts).
    // Seeded in public.test_customer_blocklist; enumerated here because
    // PostgREST doesn't support EXISTS subqueries.
    query = query.not("hcp_customer_id", "in", '("cus_9cf8cc5b02e1430a85288b034763cc19","cus_386a644b8054483788825c86c1b13b9c")');
  }

  const { data, count } = await query
    .order("job_date", { ascending: false, nullsFirst: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = (data ?? []) as JobRow[];

  // HCP fallback: if our DB returns 0 hits AND the query looks like an HCP
  // estimate number (all digits, 6-9 chars), live-lookup HCP and redirect
  // to the matching job. Cuts the "I pasted the number off the HCP page,
  // why doesn't it find anything" friction.
  const looksLikeHcpNumber = /^\d{6,9}$/.test(q);
  if (rows.length === 0 && (count ?? 0) === 0 && looksLikeHcpNumber) {
    const live = await liveLookupHcpEstimate(q);
    if (live?.hcp_job_id) {
      // Found in HCP — go straight to the job page. Tag from=hcp-estimate
      // so /job/[id] could surface a banner (future).
      redirect(`/job/${live.hcp_job_id}?from=hcp-estimate&estimate=${q}`);
    }
  }

  // Build statsQuery so we can fire it concurrently with the other two
  // remaining queries instead of serially after each one.
  let statsQuery = supa
    .from("job_360")
    .select("revenue, due_amount, gross_margin_pct, on_time")
    .order("job_date", { ascending: false, nullsFirst: false })
    .limit(500);
  if (q)      statsQuery = statsQuery.or(`customer_name.ilike.%${q}%,invoice_number.ilike.%${q}%,hcp_estimate_number.ilike.%${q}%`);
  if (effectiveTechName) {
    statsQuery = statsQuery.or(`tech_primary_name.eq."${effectiveTechName}",tech_all_names.cs.{"${effectiveTechName}"}`);
  } else if (tech) {
    statsQuery = statsQuery.eq("tech_primary_name", tech);
  }
  if (status) statsQuery = statsQuery.eq("appointment_status", status);
  if (outstandingOnly) statsQuery = statsQuery.gt("due_amount", 0);
  if (!includeInternal) {
    statsQuery = statsQuery.not("customer_name", "in", '("Tulsa Plumbing and Remodeling","TPAR","Spam","DMG","System")');
    statsQuery = statsQuery.not("hcp_customer_id", "in", '("cus_9cf8cc5b02e1430a85288b034763cc19","cus_386a644b8054483788825c86c1b13b9c")');
  }

  // Fan out: former-techs + stats aggregation + tech directory all in
  // parallel (was 3 serial awaits, ~150-400ms).
  const [formerSet, statsRes, techDirRes] = await Promise.all([
    getFormerTechNames(),
    statsQuery,
    supa
      .from("tech_directory")
      .select("hcp_full_name")
      .eq("is_active", true)
      .order("hcp_full_name", { ascending: true }),
  ]);

  const stats = (statsRes.data ?? []) as Array<{ revenue: number | null; due_amount: number | null; gross_margin_pct: number | null; on_time: boolean | null }>;
  const totalRevenue = stats.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const totalDue = stats.reduce((s, r) => s + (Number(r.due_amount) || 0), 0);
  const marginValues = stats.map((r) => Number(r.gross_margin_pct)).filter((v) => Number.isFinite(v) && v < 100);
  const avgMargin = marginValues.length > 0 ? marginValues.reduce((s, v) => s + v, 0) / marginValues.length : null;
  const onTimeStats = stats.filter((r) => r.on_time !== null);
  const onTimePct = onTimeStats.length > 0 ? (onTimeStats.filter((r) => r.on_time === true).length / onTimeStats.length) * 100 : null;

  const techNames = (techDirRes.data ?? [])
    .map((r: { hcp_full_name: string | null }) => r.hcp_full_name)
    .filter((n): n is string => Boolean(n));

  const columns: Column<JobRow>[] = [
    { header: "Date", cell: (r) => fmtDateShort(r.job_date), className: "text-neutral-600" },
    { header: "Invoice", cell: (r) => r.invoice_number ?? "—", className: "font-mono text-xs" },
    { header: "Customer", cell: (r) => r.customer_name ?? "—", className: "font-medium text-neutral-900" },
    { header: "Tech", cell: (r) => <TechName name={r.tech_primary_name} formerSet={formerSet} /> },
    { header: "Status", cell: (r) => r.appointment_status ? <StatusPill status={r.appointment_status} /> : <span className="text-neutral-400">—</span> },
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
    ? `Jobs where ${effectiveTechName} is on the crew (lead or helper).`
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
      <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Jobs (window)" value={(count ?? 0).toLocaleString()} hint={stats.length === 500 ? "stats: top 500" : `stats: all ${stats.length}`} />
        <StatCard label="Revenue (window)" value={fmtMoney(totalRevenue)} tone={totalRevenue > 0 ? "brand" : "neutral"} />
        <StatCard label="Outstanding" value={fmtMoney(totalDue)} tone={totalDue > 0 ? "red" : "neutral"} />
        <StatCard label="Avg margin" value={avgMargin != null ? fmtPct(avgMargin) : "—"} tone={avgMargin != null && avgMargin >= 30 ? "green" : avgMargin != null && avgMargin >= 15 ? "amber" : "neutral"} hint={onTimePct != null ? `${fmtPct(onTimePct)} on-time` : undefined} />
      </section>

      <div className="mb-5">
        <AppGuide
          compact
          label="Find a job"
          placeholder={"\"trotzuk\" / \"1342 east 25th\" / \"chaunce's open ar\" / \"galvanized\""}
        />
      </div>

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
        emptyText={
          q && /^\d+$/.test(q)
            ? `No job matches "${q}". Numbers from HCP estimate pages aren't always in our DB — try the customer name (e.g. "Herkender") or the invoice number from the bottom of the HCP estimate.`
            : "No jobs match those filters."
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} totalCount={count ?? null} baseHref={baseHref} />
    </PageShell>
  );
}
