// Unified comms inbox: every call/text/email landing in communication_events.
// Filter by channel / direction / customer / tech / importance.
//
// "Mine only" = filter to the signed-in tech (admins can ?as=Anthony).

import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { AppGuide } from "../../components/AppGuide";
import { Table, Pagination, FilterBar, StatusPill, fmtDateShort, type Column } from "../../components/Table";
import { StatCard } from "../../components/ui/StatCard";
import { AckButton } from "../../components/AckButton";
import { TechName } from "../../components/ui/TechName";
import { getEffectiveTechName, getCurrentTech, canResolveComms } from "../../lib/current-tech";
import { getFormerTechShortNames } from "../../lib/former-techs";
import { TechCommsView } from "./TechCommsView";

export const metadata = { title: "Comms · TPAR-DB" };

const PAGE_SIZE = 50;

// occurred_at -> "3:15 PM" in shop-local (Chicago) time.
function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

// counterparty is an E.164 / 10-digit phone for calls (a Sendbird user id for some
// texts) — pretty-print real phones, return null for anything that isn't one.
function prettyPhone(cp: string | null): string | null {
  if (!cp) return null;
  const d = cp.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return null;
}

type CommRow = {
  id: number;
  occurred_at: string;
  channel: string;
  direction: string | null;
  hcp_customer_id: string | null;
  customer_name: string | null;
  counterparty: string | null;
  tech_short_name: string | null;
  importance: number | null;
  sentiment: string | null;
  summary: string | null;
  flags: string[] | null;
  acked_at: string | null;
  raw_metadata: { attribution_source?: string } | null;
};

export default async function CommsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; channel?: string; tech?: string; min_importance?: string; include_noise?: string; mine?: string; as?: string; page?: string }>;
}) {
  // The unified inbox shows every customer's calls/texts/emails company-wide.
  // Gate to admin/manager; techs work their own comms from /me + /job/[id].
  const me = await getCurrentTech().catch(() => null);
  // Techs get a scoped view — calls/texts for the customers they're scheduled
  // with ("what pertains to me") — instead of the company-wide inbox. Anyone
  // who is neither admin/manager nor a tech (office) still goes to /me.
  if (!me?.isAdmin && !me?.isManager) {
    if (me?.tech) {
      return <TechCommsView fullName={me.tech.hcp_full_name} shortName={me.tech.tech_short_name} />;
    }
    redirect("/me");
  }
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
  // A search is a customer/topic lookup — show ALL matching comms across the
  // team so the assigned tech can review the full conversation (e.g. inbound
  // calls fielded by Madisson), not just their own. The tech filter only
  // narrows the default (unsearched) feed.
  const techFilterSuspended = !!q && (!!effectiveTechName || !!tech);

  // Managers (Madisson) can resolve comms — mirror requireResolver() here.
  const canWrite = canResolveComms(me);
  const formerShortSet = await getFormerTechShortNames();

  const supa = db();
  let query = supa
    .from("communication_events")
    .select("id, occurred_at, channel, direction, hcp_customer_id, customer_name, counterparty, tech_short_name, importance, sentiment, summary, flags, acked_at, raw_metadata", { count: "exact" });
  if (q) query = query.or(`customer_name.ilike.%${q}%,summary.ilike.%${q}%`);
  if (channel) query = query.eq("channel", channel);
  if (!q) {
    if (effectiveTechName) query = query.eq("tech_short_name", effectiveTechName);
    else if (tech) query = query.eq("tech_short_name", tech);
  }
  if (minImp > 0) query = query.gte("importance", minImp);
  // Hide noise (importance=0) unless explicitly included.
  if (!includeNoise && minImp === 0) query = query.gt("importance", 0);

  const { data, count } = await query
    .order("occurred_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = (data ?? []) as CommRow[];

  // Stat strip — same filter window, capped at 500.
  let statsQuery = supa
    .from("communication_events")
    .select("channel, importance, sentiment, flags, acked_at")
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (q) statsQuery = statsQuery.or(`customer_name.ilike.%${q}%,summary.ilike.%${q}%`);
  if (channel) statsQuery = statsQuery.eq("channel", channel);
  if (!q) {
    if (effectiveTechName) statsQuery = statsQuery.eq("tech_short_name", effectiveTechName);
    else if (tech) statsQuery = statsQuery.eq("tech_short_name", tech);
  }
  if (minImp > 0) statsQuery = statsQuery.gte("importance", minImp);
  if (!includeNoise && minImp === 0) statsQuery = statsQuery.gt("importance", 0);
  const { data: statsRows } = await statsQuery;
  const stats = (statsRows ?? []) as Array<{ channel: string; importance: number | null; sentiment: string | null; flags: string[] | null; acked_at: string | null }>;
  const calls = stats.filter((r) => r.channel === "call").length;
  const texts = stats.filter((r) => r.channel === "text").length;
  const flagged = stats.filter((r) => r.flags?.some((f) => ["needs_followup","unresolved","escalation_needed"].includes(f))).length;
  const unacked = stats.filter((r) => r.flags?.some((f) => ["needs_followup","unresolved","escalation_needed"].includes(f)) && !r.acked_at).length;

  const columns: Column<CommRow>[] = [
    {
      header: "When",
      cell: (r) => (
        <div className="whitespace-nowrap text-neutral-600">
          <div>{fmtDateShort(r.occurred_at)}</div>
          <div className="text-[11px] text-neutral-400">{fmtTime(r.occurred_at)}</div>
        </div>
      ),
    },
    {
      header: "Channel",
      cell: (r) => {
        const tone =
          r.channel === "call" ? "brand" :
          r.channel === "text" ? "green" :
          r.channel === "email" ? "slate" :
          "neutral";
        return <StatusPill status={r.channel} tone={tone as "brand" | "green" | "slate" | "neutral"} />;
      },
    },
    { header: "Dir", cell: (r) => r.direction ?? "—", className: "text-xs uppercase text-neutral-500" },
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
    {
      header: "Phone",
      cell: (r) => {
        const p = prettyPhone(r.counterparty);
        return p ? (
          <a href={`tel:${r.counterparty}`} className="whitespace-nowrap text-sm text-neutral-700 hover:underline">
            {p}
          </a>
        ) : (
          <span className="text-neutral-400">—</span>
        );
      },
    },
    {
      header: "Tech",
      cell: (r) => {
        const isInferred = r.raw_metadata?.attribution_source === "inferred_from_nearest_appointment";
        return (
          <span className="inline-flex items-center gap-1">
            <TechName name={r.tech_short_name} formerSet={formerShortSet} />
            {isInferred && (
              <span
                className="text-[10px] text-amber-600"
                title="Inferred from nearest job assignment — not confirmed via caller identity."
              >
                ⌖
              </span>
            )}
          </span>
        );
      },
    },
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
              <AckButton commId={r.id} acked={!!r.acked_at} canWrite={canWrite} />
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
      icon="💬"
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
      <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Events (window)" value={(count ?? 0).toLocaleString()} hint={stats.length === 500 ? "stats: top 500" : `stats: all ${stats.length}`} />
        <StatCard label="Calls" value={calls.toLocaleString()} tone={calls > 0 ? "brand" : "neutral"} />
        <StatCard label="Texts" value={texts.toLocaleString()} tone={texts > 0 ? "green" : "neutral"} />
        <StatCard label="Needs follow-up" value={unacked.toLocaleString()} tone={unacked > 0 ? "amber" : "neutral"} hint={flagged > 0 ? `${flagged} flagged total` : undefined} />
      </section>

      <div className="mb-5">
        <AppGuide
          compact
          label="Find a job from a comm"
          placeholder={"\"trotzuk\" / \"chaunce's open ar\" / \"galvanized\" / leave empty for today"}
        />
      </div>

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

      {techFilterSuspended ? (
        <div className="mb-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
          Showing <strong>all</strong> comms matching “{q}” across the team — the tech filter is paused during search so you see the customer&apos;s full conversation, including inbound calls others handled.
        </div>
      ) : null}
      <Table columns={columns} rows={rows} emptyText="No comms match those filters." />
      <Pagination page={page} pageSize={PAGE_SIZE} totalCount={count ?? null} baseHref={baseHref} />
    </PageShell>
  );
}
