// Unified comms inbox: every call/text/email landing in communication_events.
// Filter by channel / direction / customer / tech / importance.
//
// "Mine only" = filter to the signed-in tech (admins can ?as=Anthony).

import Link from "next/link";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { Table, Pagination, FilterBar, fmtDateShort, type Column } from "../../components/Table";
import { AckButton } from "../../components/AckButton";
import { getEffectiveTechName } from "../../lib/current-tech";

export const metadata = { title: "Comms · TPAR-DB" };

const PAGE_SIZE = 50;

type CommRow = {
  id: number;
  occurred_at: string;
  channel: string;
  direction: string | null;
  hcp_customer_id: string | null;
  customer_name: string | null;
  tech_short_name: string | null;
  importance: number | null;
  sentiment: string | null;
  summary: string | null;
  flags: string[] | null;
  acked_at: string | null;
};

export default async function CommsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; channel?: string; tech?: string; min_importance?: string; include_noise?: string; mine?: string; as?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const channel = (params.channel ?? "").trim();
  const tech = (params.tech ?? "").trim();
  const minImp = Number(params.min_importance ?? "0");
  // Noise = importance=0 events. Per 04-30 observation, 28.8% of comms are
  // imp=0 (mostly HCP system notifications); default to hiding them.
  const includeNoise = params.include_noise === "1";
  const mineOnly = params.mine === "1";
  const asOverride = (params.as ?? "").trim() || null;
  const page = Math.max(1, Number(params.page ?? "1"));

  // communication_events.tech_short_name uses the short name (e.g. "Danny"),
  // so we filter on shortName here.
  const effective = mineOnly ? await getEffectiveTechName(asOverride) : null;
  const effectiveTechName = effective?.shortName ?? null;

  const supa = db();
  let query = supa
    .from("communication_events")
    .select("id, occurred_at, channel, direction, hcp_customer_id, customer_name, tech_short_name, importance, sentiment, summary, flags, acked_at", { count: "exact" });
  if (q) query = query.or(`customer_name.ilike.%${q}%,summary.ilike.%${q}%`);
  if (channel) query = query.eq("channel", channel);
  if (effectiveTechName) query = query.eq("tech_short_name", effectiveTechName);
  else if (tech) query = query.eq("tech_short_name", tech);
  if (minImp > 0) query = query.gte("importance", minImp);
  // Hide noise (importance=0) unless explicitly included.
  if (!includeNoise && minImp === 0) query = query.gt("importance", 0);

  const { data, count } = await query
    .order("occurred_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = (data ?? []) as CommRow[];

  const columns: Column<CommRow>[] = [
    { header: "When", cell: (r) => fmtDateShort(r.occurred_at), className: "text-neutral-600" },
    { header: "Channel", cell: (r) => r.channel, className: "text-xs uppercase text-neutral-500" },
    { header: "Dir", cell: (r) => r.direction ?? "—", className: "text-xs text-neutral-500" },
    {
      header: "Customer",
      cell: (r) =>
        r.hcp_customer_id ? (
          <Link href={`/customer/${r.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">
            {r.customer_name ?? "—"}
          </Link>
        ) : (
          <span className="font-medium text-neutral-900">{r.customer_name ?? "—"}</span>
        ),
    },
    { header: "Tech", cell: (r) => r.tech_short_name ?? "—" },
    {
      header: "Imp",
      cell: (r) =>
        r.importance != null ? (
          <span
            className={
              r.importance >= 7
                ? "font-medium text-amber-700"
                : r.importance >= 5
                ? "text-neutral-700"
                : "text-neutral-400"
            }
          >
            {r.importance}
          </span>
        ) : (
          "—"
        ),
      align: "right",
    },
    {
      header: "Summary",
      cell: (r) => (
        <div className="max-w-xl">
          <div className="text-xs text-neutral-700">{r.summary?.slice(0, 250) ?? "—"}</div>
          {(r.flags && r.flags.some((f) => f === "needs_followup" || f === "unresolved" || f === "escalation_needed")) && (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-amber-700">
                {r.flags.filter((f) => ["needs_followup", "unresolved", "escalation_needed"].includes(f)).join(", ")}
              </span>
              <AckButton commId={r.id} acked={!!r.acked_at} />
            </div>
          )}
        </div>
      ),
    },
  ];

  const sharedFilters = {
    ...(q ? { q } : {}),
    ...(channel ? { channel } : {}),
    ...(tech && !mineOnly ? { tech } : {}),
    ...(minImp ? { min_importance: String(minImp) } : {}),
    ...(includeNoise ? { include_noise: "1" } : {}),
    ...(mineOnly ? { mine: "1" } : {}),
    ...(asOverride ? { as: asOverride } : {}),
  };
  const baseHref = `/comms?${new URLSearchParams(sharedFilters).toString()}`;
  const csvHref = `/comms/export.csv?${new URLSearchParams(sharedFilters).toString()}`;

  return (
    <PageShell
      title="Comms"
      description={effectiveTechName ? `Comms attributed to ${effectiveTechName}.` : "Unified inbox of every call, text, email across all channels."}
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
        {effective ? (
          <span className="inline-flex items-center gap-2 self-end pb-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
            Mine only{effective.viewingAs ? ` · ${effective.viewingAs}` : ""}
            <a href={`/comms?${new URLSearchParams({ ...(q ? { q } : {}), ...(channel ? { channel } : {}), ...(minImp ? { min_importance: String(minImp) } : {}), ...(includeNoise ? { include_noise: "1" } : {}) }).toString()}`} className="ml-1 text-emerald-700 hover:text-emerald-900" aria-label="Clear mine filter">×</a>
          </span>
        ) : null}
        <label className="block">
          <span className="block text-xs font-medium text-neutral-600">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="customer name or text"
            className="mt-1 w-64 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-neutral-600">Channel</span>
          <select name="channel" defaultValue={channel} className="mt-1 w-32 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm">
            <option value="">All</option>
            <option value="call">call</option>
            <option value="text">text</option>
            <option value="email">email</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-neutral-600">Tech</span>
          <input
            type="text"
            name="tech"
            defaultValue={tech}
            placeholder="e.g. Madisson"
            className="mt-1 w-32 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-neutral-600">Min importance</span>
          <select name="min_importance" defaultValue={String(minImp)} className="mt-1 w-32 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm">
            <option value="0">Any</option>
            <option value="5">≥ 5</option>
            <option value="7">≥ 7</option>
            <option value="9">≥ 9</option>
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-1">
          <input
            type="checkbox"
            name="include_noise"
            value="1"
            defaultChecked={includeNoise}
            className="h-4 w-4 rounded border-neutral-300"
          />
          <span className="text-xs text-neutral-600">Include importance-0 (system notifications, ~29% of volume)</span>
        </label>
        <button
          type="submit"
          className="ml-auto rounded-md bg-brand-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
        >
          Apply
        </button>
      </FilterBar>

      <Table columns={columns} rows={rows} emptyText="No comms match those filters." />
      <Pagination page={page} pageSize={PAGE_SIZE} totalCount={count ?? null} baseHref={baseHref} />
    </PageShell>
  );
}
