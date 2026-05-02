// Time card view — polished version.
// Top: live "currently on the clock" status.
// Then: day-by-day cards, each with per-tech totals + event timeline.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { TechName } from "@/components/ui/TechName";
import { Pill } from "@/components/ui/Pill";
import { StatCard } from "@/components/ui/StatCard";
import { getFormerTechNames } from "@/lib/former-techs";
import Link from "next/link";

export const dynamic = "force-dynamic";

type EntryRow = {
  id: string;
  tech_id: string | null;
  tech_short_name: string | null;
  kind: string;
  ts: string;
  hcp_appointment_id: string | null;
  hcp_job_id: string | null;
  notes: string | null;
  source: string;
  hcp_mirror_status: string;
  voided_at: string | null;
  created_by: string | null;
};

type CurrentlyClockedInRow = {
  tech_id: string;
  tech_short_name: string | null;
  clocked_in_at: string;
  duration_seconds: number;
  hcp_job_id: string | null;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
function localDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}
function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0 && m === 0) return seconds > 0 ? `<1m` : "—";
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function formatDurationFromSec(s: number): string {
  return formatDuration(s * 1000);
}

type PerTechBucket = {
  tech_id: string | null;
  tech_short_name: string | null;
  entries: EntryRow[];
  total_clocked_ms: number;
  has_open: boolean;
};

type DayBucket = {
  date: string;
  date_label: string;
  per_tech: PerTechBucket[];
  total_entries: number;
  total_clocked_ms: number;
  has_open: boolean;
};

function computeDayBuckets(entries: EntryRow[]): DayBucket[] {
  // Group by (date, tech)
  const map = new Map<string, Map<string, EntryRow[]>>();
  for (const e of entries) {
    const dk = localDateKey(e.ts);
    const tk = e.tech_id ?? "__unknown__";
    if (!map.has(dk)) map.set(dk, new Map());
    const tm = map.get(dk)!;
    if (!tm.has(tk)) tm.set(tk, []);
    tm.get(tk)!.push(e);
  }

  const days: DayBucket[] = [];
  for (const [date, techMap] of map) {
    const perTech: PerTechBucket[] = [];
    let dayTotalMs = 0;
    let dayHasOpen = false;
    let dayCount = 0;

    for (const [, list] of techMap) {
      const sortedAsc = [...list].sort((a, b) => a.ts.localeCompare(b.ts));
      let total = 0;
      let openIn: number | null = null;
      for (const e of sortedAsc) {
        if (e.voided_at) continue;
        if (e.kind === "in") openIn = new Date(e.ts).getTime();
        else if (e.kind === "out" && openIn !== null) {
          total += new Date(e.ts).getTime() - openIn;
          openIn = null;
        }
      }
      const hasOpen = openIn !== null;
      perTech.push({
        tech_id: list[0]?.tech_id ?? null,
        tech_short_name: list[0]?.tech_short_name ?? null,
        entries: [...list].sort((a, b) => b.ts.localeCompare(a.ts)),
        total_clocked_ms: total,
        has_open: hasOpen,
      });
      dayTotalMs += total;
      if (hasOpen) dayHasOpen = true;
      dayCount += list.length;
    }
    perTech.sort((a, b) => (a.tech_short_name ?? "").localeCompare(b.tech_short_name ?? ""));
    days.push({
      date,
      date_label: formatDateLong(`${date}T12:00:00-05:00`),
      per_tech: perTech,
      total_entries: dayCount,
      total_clocked_ms: dayTotalMs,
      has_open: dayHasOpen,
    });
  }
  days.sort((a, b) => b.date.localeCompare(a.date));
  return days;
}

function ClockKindIcon({ kind }: { kind: string }) {
  if (kind === "in") {
    return (
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
          <path d="M5 10l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
  }
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
        <rect x="5" y="5" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="2"/>
      </svg>
    </span>
  );
}

export default async function TimePage() {
  const me = await getCurrentTech();
  if (!me) {
    return (
      <PageShell title="Time">
        <EmptyState title="Sign in" description="Sign in with your @tulsapar.com account to see your time card." />
      </PageShell>
    );
  }

  const supabase = db();
  const formerSet = await getFormerTechNames();

  // Live currently-clocked-in (admins/managers see all; tech sees just self)
  let liveQuery = supabase
    .from("tech_currently_clocked_in_v")
    .select("tech_id, tech_short_name, clocked_in_at, duration_seconds, hcp_job_id");
  if (!me.isAdmin && !me.isManager && me.tech?.tech_id) {
    liveQuery = liveQuery.eq("tech_id", me.tech.tech_id);
  } else if (!me.isAdmin && !me.isManager) {
    liveQuery = liveQuery.eq("tech_id", "__none__");
  }
  const { data: liveData } = await liveQuery;
  const live = (liveData ?? []) as CurrentlyClockedInRow[];

  // History (latest 200 events)
  let histQuery = supabase
    .from("tech_time_entries")
    .select("id, tech_id, tech_short_name, kind, ts, hcp_appointment_id, hcp_job_id, notes, source, hcp_mirror_status, voided_at, created_by")
    .order("ts", { ascending: false })
    .limit(200);
  if (!me.isAdmin && !me.isManager && me.tech?.tech_id) {
    histQuery = histQuery.eq("tech_id", me.tech.tech_id);
  } else if (!me.isAdmin && !me.isManager) {
    histQuery = histQuery.eq("tech_id", "__none__");
  }
  const { data: histData, error: histErr } = await histQuery;
  const rows = (histData ?? []) as EntryRow[];

  if (histErr) {
    return (
      <PageShell title="Time">
        <EmptyState title="Failed to load entries" description={histErr.message} />
      </PageShell>
    );
  }

  const buckets = computeDayBuckets(rows);
  const scopeLabel = me.isAdmin || me.isManager ? "All techs" : (me.tech?.tech_short_name ?? "you");

  return (
    <PageShell
      kicker="Time tracking"
      title="Time card"
      description={`Latest 200 events · scope: ${scopeLabel}`}
    >
      {/* Live status */}
      {live.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
            On the clock now
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {live.map((l) => (
              <div
                key={l.tech_id}
                className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm"
              >
                <div aria-hidden className="pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full bg-emerald-200/40 blur-2xl" />
                <div className="relative flex items-baseline gap-2">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                  <span className="text-base font-semibold text-emerald-900">
                    <TechName name={l.tech_short_name} formerSet={formerSet} />
                  </span>
                </div>
                <div className="relative mt-2 text-2xl font-semibold tabular-nums tracking-tight text-emerald-700">
                  {formatDurationFromSec(l.duration_seconds)}
                </div>
                <div className="relative mt-1 text-xs text-emerald-700/80">
                  since {formatTime(l.clocked_in_at)}
                  {l.hcp_job_id && (
                    <>
                      {" · "}
                      <Link href={`/job/${l.hcp_job_id}`} className="hover:underline">
                        job
                      </Link>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {buckets.length === 0 ? (
        <EmptyState
          title="No clock events yet"
          description="Tap the green CLOCK IN button on the home page to start your day. Events show up here as they happen."
          action={
            <Link href="/" className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              Go to home
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {buckets.map((b) => (
            <section
              key={b.date}
              className={
                "overflow-hidden rounded-2xl border bg-white shadow-sm " +
                (b.has_open ? "border-emerald-200" : "border-neutral-200")
              }
            >
              <div className="flex flex-wrap items-baseline gap-3 border-b border-neutral-100 bg-neutral-50/60 px-4 py-3">
                <h3 className="text-base font-semibold text-neutral-900">{b.date_label}</h3>
                <span className="text-xs text-neutral-500">{b.date}</span>
                {b.has_open && <Pill tone="green">currently on the clock</Pill>}
                <div className="ml-auto flex flex-wrap items-baseline gap-3 text-sm">
                  <span className="text-neutral-500">Day total</span>
                  <span className="text-lg font-semibold tabular-nums tracking-tight text-neutral-900">
                    {formatDuration(b.total_clocked_ms)}
                  </span>
                  <span className="text-xs text-neutral-400">·</span>
                  <span className="text-xs text-neutral-500">{b.total_entries} event{b.total_entries === 1 ? "" : "s"}</span>
                </div>
              </div>

              <div className="divide-y divide-neutral-100">
                {b.per_tech.map((pt) => (
                  <div key={(pt.tech_id ?? "?") + b.date} className="px-4 py-3">
                    <div className="mb-2 flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-medium text-neutral-900">
                        <TechName name={pt.tech_short_name} formerSet={formerSet} />
                      </span>
                      <span className="text-xs text-neutral-500">
                        {formatDuration(pt.total_clocked_ms)}
                      </span>
                      {pt.has_open && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                          on the clock
                        </span>
                      )}
                    </div>
                    <ul className="space-y-1.5">
                      {pt.entries.map((e) => (
                        <li key={e.id} className={"flex flex-wrap items-center gap-2 text-sm " + (e.voided_at ? "opacity-50 line-through" : "")}>
                          <ClockKindIcon kind={e.kind} />
                          <span className="font-mono tabular-nums text-neutral-900">{formatTime(e.ts)}</span>
                          <span className="text-neutral-700">{e.kind === "in" ? "Clock in" : "Clock out"}</span>
                          {e.hcp_job_id && (
                            <Link href={`/job/${e.hcp_job_id}`} className="text-xs text-brand-700 hover:underline">
                              · {e.hcp_job_id.slice(0, 12)}…
                            </Link>
                          )}
                          {e.source !== "tech-web" && (
                            <span className="text-xs text-neutral-500">· {e.source}</span>
                          )}
                          {e.hcp_mirror_status === "pending" && (
                            <Pill tone="amber">mirror pending</Pill>
                          )}
                          {e.hcp_mirror_status === "failed" && (
                            <Pill tone="red">mirror failed</Pill>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageShell>
  );
}
