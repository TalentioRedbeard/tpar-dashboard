// FreshnessStrip — server component showing "when was each upstream
// data source last synced." Rendered on AdminHome so leadership can
// glance and trust (or distrust) what they're looking at.
//
// Source: maintenance_logs MAX(ts) per source, mapped to user-friendly
// labels with an expected cadence. Sources whose last fire is older
// than ~2x cadence render in amber; older than ~4x in red.
//
// This is server-rendered, so the values reflect when the page was
// rendered. A page navigation re-renders it.

import { db } from "@/lib/supabase";

type SourceKey = "hcp" | "salesask" | "bouncie" | "texts" | "calls" | "embeddings";

type FreshnessSource = {
  key: SourceKey;
  label: string;
  // Source names in maintenance_logs. We take MAX(ts) across all of them.
  loggers: string[];
  // Expected lag in minutes (how stale data should ever get under normal cadence).
  expectedLagMin: number;
};

const SOURCES: FreshnessSource[] = [
  { key: "hcp",        label: "HCP",         loggers: ["hcp-sync-appointments", "hcp-webhook"], expectedLagMin: 130 },
  { key: "salesask",   label: "SalesAsk",    loggers: ["salesask-sync", "salesask_sync_hourly"], expectedLagMin: 70 },
  { key: "bouncie",    label: "Bouncie",     loggers: ["tpar-bouncie-sync-trips-daily"], expectedLagMin: 1500 },
  { key: "texts",      label: "Texts",       loggers: ["hourly_extract_texts"], expectedLagMin: 70 },
  { key: "calls",      label: "Calls",       loggers: ["hourly_transcribe_calls"], expectedLagMin: 70 },
  { key: "embeddings", label: "Embeddings",  loggers: ["hourly_embed_events"], expectedLagMin: 70 },
];

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.round((ms % 3_600_000) / 60_000);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  return `${Math.round(ms / 86_400_000)}d`;
}

function staleness(lastSeen: string | null, expectedLagMin: number): "fresh" | "stale" | "very-stale" | "missing" {
  if (!lastSeen) return "missing";
  const ageMin = (Date.now() - new Date(lastSeen).getTime()) / 60_000;
  if (ageMin < expectedLagMin) return "fresh";
  if (ageMin < expectedLagMin * 2) return "stale";
  return "very-stale";
}

export async function FreshnessStrip() {
  const supabase = db();
  const allLoggers = SOURCES.flatMap((s) => s.loggers);
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();

  const { data: rows } = await supabase
    .from("maintenance_logs")
    .select("source, ts")
    .in("source", allLoggers)
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(2000);

  const lastBySource = new Map<string, string>();
  for (const r of (rows ?? []) as Array<{ source: string; ts: string }>) {
    if (!lastBySource.has(r.source)) lastBySource.set(r.source, r.ts);
  }

  const items = SOURCES.map((s) => {
    let last: string | null = null;
    for (const lg of s.loggers) {
      const v = lastBySource.get(lg);
      if (v && (!last || v > last)) last = v;
    }
    return { ...s, lastSeen: last, state: staleness(last, s.expectedLagMin) };
  });

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3 text-xs">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-semibold uppercase tracking-[0.12em] text-neutral-500">
          Data freshness
        </span>
        <span className="text-[10px] text-neutral-400">
          rendered {new Date().toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })} CT · refresh page to update
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {items.map((it) => (
          <div key={it.key} className="flex items-center gap-1.5">
            <Dot state={it.state} />
            <span className="font-medium text-neutral-700">{it.label}</span>
            <span className="tabular-nums text-neutral-500">
              {it.lastSeen ? fmtAgo(it.lastSeen) : "no recent data"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dot({ state }: { state: "fresh" | "stale" | "very-stale" | "missing" }) {
  const cls =
    state === "fresh"
      ? "bg-emerald-500"
      : state === "stale"
      ? "bg-amber-500"
      : state === "very-stale"
      ? "bg-red-500"
      : "bg-neutral-300";
  const title =
    state === "fresh"
      ? "Within expected cadence"
      : state === "stale"
      ? "Older than expected"
      : state === "very-stale"
      ? "Significantly stale — check the cron"
      : "No recent data";
  return (
    <span
      aria-label={title}
      title={title}
      className={`inline-block h-1.5 w-1.5 rounded-full ${cls}`}
    />
  );
}
