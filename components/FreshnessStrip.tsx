// FreshnessStrip — two-signal data health: data arrival + cron firing.
//
// Background (2026-05-11): the previous v relied only on MAX(<data_col>) of
// each source, with tight 4h thresholds. Two problems:
//   1. Activity-driven sources (texts, calls, Bouncie) don't fire every 4h —
//      slow evenings legit gap. Panel screamed false-stale every night.
//   2. A cron silently failing was invisible if it had recently written data
//      (the 6-day comms outage 2026-04-30→2026-05-07 was the canary).
//
// New model:
//   data signal — MAX(<data_col>) from source table
//   cron signal — last_success_at from cron_last_success_v
//
// State:
//   BROKEN (red)  — cron has not fired successfully past its expected interval.
//                   The system is not trying. Real outage.
//   FRESH (green) — cron healthy AND data within source's natural window.
//   QUIET (gray)  — cron healthy, no recent data. System fine; activity is just
//                   sparse (slow evening, weekend, etc.). NOT an alarm.
//   MISSING       — never seen either signal.

import { db } from "@/lib/supabase";
import { UpdateButton } from "./UpdateButton";

type SourceKey = "hcp" | "salesask" | "bouncie" | "texts" | "calls" | "embeddings";
type FreshState = "fresh" | "quiet" | "broken" | "missing";

type SourceConfig = {
  key: SourceKey;
  label: string;
  cronJobName: string;
  cronExpectedLagMin: number;  // cron silent past this = broken
  dataExpectedLagMin: number;  // data silent past this on a HEALTHY cron = quiet (not broken)
};

// Tuned per source's natural cadence. Cron lag matches schedule + buffer;
// data lag matches activity pattern (humans don't text us every 4h).
const SOURCES: SourceConfig[] = [
  // tpar-appointments-sync runs every 2h on schedule 13/15/17/19/21/23/1 UTC
  { key: "hcp",        label: "HCP",        cronJobName: "tpar-appointments-sync",          cronExpectedLagMin: 150, dataExpectedLagMin: 720 },
  { key: "salesask",   label: "SalesAsk",   cronJobName: "salesask_sync_hourly",            cronExpectedLagMin: 75,  dataExpectedLagMin: 720 },
  // bouncie sync runs once daily at 9:30 UTC; daytime activity is webhook-driven
  { key: "bouncie",    label: "Bouncie",    cronJobName: "tpar-bouncie-sync-trips-daily",   cronExpectedLagMin: 1560, dataExpectedLagMin: 720 },
  { key: "texts",      label: "Texts",      cronJobName: "hourly_extract_texts",            cronExpectedLagMin: 75,  dataExpectedLagMin: 720 },
  { key: "calls",      label: "Calls",      cronJobName: "hourly_transcribe_calls",         cronExpectedLagMin: 75,  dataExpectedLagMin: 720 },
  { key: "embeddings", label: "Embeddings", cronJobName: "hourly_embed_events",             cronExpectedLagMin: 75,  dataExpectedLagMin: 360 },
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

function combinedState(dataLast: string | null, cronLast: string | null, cfg: SourceConfig): FreshState {
  if (!dataLast && !cronLast) return "missing";
  const now = Date.now();
  const cronAgeMin = cronLast ? (now - new Date(cronLast).getTime()) / 60_000 : Infinity;
  const dataAgeMin = dataLast ? (now - new Date(dataLast).getTime()) / 60_000 : Infinity;

  // Cron silence past its expected interval is the real outage signal.
  if (cronAgeMin > cfg.cronExpectedLagMin) return "broken";

  // Cron healthy. Now: is data recent enough to call this active?
  if (dataAgeMin < cfg.dataExpectedLagMin) return "fresh";

  // Cron firing, but data sparse — expected lull, not an alarm.
  return "quiet";
}

async function fetchSignals(): Promise<Record<SourceKey, { data: string | null; cron: string | null }>> {
  const supabase = db();

  // Data signals — one query per source's data table
  const [hcp, salesask, bouncie, texts, calls, embeddings] = await Promise.all([
    supabase.from("appointments_master").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("salesask_recordings").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("bouncie_trips").select("ended_at").not("ended_at", "is", null).order("ended_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("communication_events").select("occurred_at").eq("channel", "text").order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("communication_events").select("occurred_at").eq("channel", "call").order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("entity_embeddings").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  // Cron signals — single query for all the cron names we care about
  const cronJobNames = SOURCES.map((s) => s.cronJobName);
  const { data: cronRows } = await supabase
    .from("cron_last_success_v")
    .select("jobname, last_success_at")
    .in("jobname", cronJobNames);
  const cronByName = new Map<string, string | null>(
    (cronRows ?? []).map((r) => [r.jobname as string, (r.last_success_at as string | null) ?? null])
  );

  const dataByKey: Record<SourceKey, string | null> = {
    hcp:        (hcp.data        as { updated_at?: string }  | null)?.updated_at  ?? null,
    salesask:   (salesask.data   as { updated_at?: string }  | null)?.updated_at  ?? null,
    bouncie:    (bouncie.data    as { ended_at?: string }    | null)?.ended_at    ?? null,
    texts:      (texts.data      as { occurred_at?: string } | null)?.occurred_at ?? null,
    calls:      (calls.data      as { occurred_at?: string } | null)?.occurred_at ?? null,
    embeddings: (embeddings.data as { created_at?: string }  | null)?.created_at  ?? null,
  };

  const out: Record<SourceKey, { data: string | null; cron: string | null }> = {} as Record<SourceKey, { data: string | null; cron: string | null }>;
  for (const s of SOURCES) {
    out[s.key] = { data: dataByKey[s.key], cron: cronByName.get(s.cronJobName) ?? null };
  }
  return out;
}

export async function FreshnessStrip() {
  const signals = await fetchSignals();

  const items = SOURCES.map((s) => {
    const sig = signals[s.key];
    return { ...s, dataSeen: sig.data, cronSeen: sig.cron, state: combinedState(sig.data, sig.cron, s) };
  });

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3 text-xs">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-semibold uppercase tracking-[0.12em] text-neutral-500">
          Data freshness
        </span>
        <span className="text-[10px] text-neutral-400">
          rendered {new Date().toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })} CT · cron + data · refresh to update
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {items.map((it) => (
          <div key={it.key} className="flex flex-col items-start gap-0.5">
            <div className="flex items-center gap-1.5">
              <Dot state={it.state} />
              <span className="font-medium text-neutral-700">{it.label}</span>
              <span className="tabular-nums text-neutral-500">
                {it.dataSeen ? fmtAgo(it.dataSeen) : "no recent data"}
              </span>
              {it.state === "quiet" ? (
                <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                  quiet
                </span>
              ) : null}
              {it.state === "broken" ? (
                <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-red-700">
                  cron silent
                </span>
              ) : null}
            </div>
            <div className="ml-3 text-[10px] text-neutral-400">
              cron: {it.cronSeen ? fmtAgo(it.cronSeen) : "never"}
            </div>
            <div className="ml-3 mt-0.5">
              <UpdateButton source={it.key} label={it.label} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dot({ state }: { state: FreshState }) {
  const cls =
    state === "fresh"
      ? "bg-emerald-500"
      : state === "quiet"
      ? "bg-neutral-300"
      : state === "broken"
      ? "bg-red-500"
      : "bg-neutral-300";
  const title =
    state === "fresh"
      ? "Recent data + cron healthy"
      : state === "quiet"
      ? "Cron firing, no recent activity (expected on slow periods)"
      : state === "broken"
      ? "Cron has not fired recently — real outage; investigate"
      : "No data and no cron history";
  return (
    <span
      aria-label={title}
      title={title}
      className={`inline-block h-1.5 w-1.5 rounded-full ${cls}`}
    />
  );
}
