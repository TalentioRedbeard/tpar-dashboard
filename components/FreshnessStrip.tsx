// FreshnessStrip — server component showing "when did real data last land
// for each upstream source." Rendered on AdminHome so leadership can glance
// and trust (or distrust) what they're looking at.
//
// Source-of-truth (changed 2026-05-07): we now read MAX(<data timestamp>) on
// each source's actual data table — NOT MAX(ts) on maintenance_logs. The
// 6-day comms outage (2026-04-30 → 2026-05-07) was hidden because pg_cron
// fired hourly and wrote "cron fired" to maintenance_logs even while the
// bot was silently failing on expired HCP auth. Tracking data, not cron,
// makes that class of outage visible immediately.
//
// Cron firing is still useful as a SECONDARY signal — when data is sparse
// by nature (calls on a quiet morning), a healthy cron prevents false red.
// Reserved as a follow-up enhancement; v1 here is data-only.

import { db } from "@/lib/supabase";
import { triggerSync } from "@/app/actions/sync-actions";
import { UpdateButton } from "./UpdateButton";

type SourceKey = "hcp" | "salesask" | "bouncie" | "texts" | "calls" | "embeddings";

type FreshnessSource = {
  key: SourceKey;
  label: string;
  // Expected data-arrival lag in minutes. Tuned to natural activity, not
  // cron cadence — calls don't happen every hour, but we expect at least
  // one within ~4h on a normal workday.
  expectedLagMin: number;
};

const SOURCES: FreshnessSource[] = [
  { key: "hcp",        label: "HCP",        expectedLagMin: 240 },
  { key: "salesask",   label: "SalesAsk",   expectedLagMin: 240 },
  { key: "bouncie",    label: "Bouncie",    expectedLagMin: 240 },
  { key: "texts",      label: "Texts",      expectedLagMin: 240 },
  { key: "calls",      label: "Calls",      expectedLagMin: 240 },
  { key: "embeddings", label: "Embeddings", expectedLagMin: 120 },
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

// Each source's freshness query. Returns ISO timestamp of the most recent
// data row, or null. Queries run in parallel via Promise.all.
async function fetchFreshness(): Promise<Record<SourceKey, string | null>> {
  const supabase = db();

  const [hcp, salesask, bouncie, texts, calls, embeddings] = await Promise.all([
    supabase
      .from("appointments_master")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("salesask_recordings")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("bouncie_trips")
      .select("ended_at")
      .order("ended_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("communication_events")
      .select("occurred_at")
      .eq("channel", "text")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("communication_events")
      .select("occurred_at")
      .eq("channel", "call")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("entity_embeddings")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    hcp:        (hcp.data        as { updated_at?: string } | null)?.updated_at        ?? null,
    salesask:   (salesask.data   as { updated_at?: string } | null)?.updated_at        ?? null,
    bouncie:    (bouncie.data    as { ended_at?: string }   | null)?.ended_at          ?? null,
    texts:      (texts.data      as { occurred_at?: string }| null)?.occurred_at       ?? null,
    calls:      (calls.data      as { occurred_at?: string }| null)?.occurred_at       ?? null,
    embeddings: (embeddings.data as { created_at?: string } | null)?.created_at        ?? null,
  };
}

export async function FreshnessStrip() {
  const lastByKey = await fetchFreshness();

  const items = SOURCES.map((s) => {
    const last = lastByKey[s.key];
    return { ...s, lastSeen: last, state: staleness(last, s.expectedLagMin) };
  });

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3 text-xs">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-semibold uppercase tracking-[0.12em] text-neutral-500">
          Data freshness
        </span>
        <span className="text-[10px] text-neutral-400">
          rendered {new Date().toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })} CT · last data row, not last cron fire · refresh to update
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {items.map((it) => (
          <div key={it.key} className="flex flex-col items-start gap-0.5">
            <div className="flex items-center gap-1.5">
              <Dot state={it.state} />
              <span className="font-medium text-neutral-700">{it.label}</span>
              <span className="tabular-nums text-neutral-500">
                {it.lastSeen ? fmtAgo(it.lastSeen) : "no recent data"}
              </span>
            </div>
            <form action={triggerSync} className="ml-3">
              <input type="hidden" name="source" value={it.key} />
              <UpdateButton label={it.label} />
            </form>
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
      ? "Latest data row within expected window"
      : state === "stale"
      ? "Latest data row older than expected"
      : state === "very-stale"
      ? "Latest data row significantly stale — check the upstream sync"
      : "No data found";
  return (
    <span
      aria-label={title}
      title={title}
      className={`inline-block h-1.5 w-1.5 rounded-full ${cls}`}
    />
  );
}
