// FreshnessStrip — reads public.data_freshness_v (a single source of truth
// for cron-firing + data-arrival per source). One query, one verdict per
// source. The view computes state in SQL:
//   broken — cron silent past expected interval. Real outage.
//   fresh  — cron healthy AND data within natural window.
//   quiet  — cron healthy, data sparse. Expected lull (NOT alarm).
//   missing — no cron, no data.
//
// Adding a new source: extend the VALUES tuple in data_freshness_v's
// migration. Component renders whatever rows the view returns.

import { db } from "@/lib/supabase";
import { UpdateButton } from "./UpdateButton";

type FreshState = "fresh" | "quiet" | "broken" | "missing";

type FreshRow = {
  source: string;
  label: string;
  cron_job_name: string;
  state: FreshState;
  data_age_min: number | null;
  cron_age_min: number | null;
};

function fmtMin(min: number | null): string {
  if (min == null) return "—";
  if (min < 1) return "<1m";
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 60 * 24) {
    const h = Math.floor(min / 60);
    const m = Math.round(min - h * 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  return `${Math.round(min / (60 * 24))}d`;
}

export async function FreshnessStrip() {
  const supabase = db();
  const { data } = await supabase
    .from("data_freshness_v")
    .select("source, label, cron_job_name, state, data_age_min, cron_age_min")
    .order("source");

  const rows = (data ?? []) as FreshRow[];

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
        {rows.map((it) => (
          <div key={it.source} className="flex flex-col items-start gap-0.5">
            <div className="flex items-center gap-1.5">
              <Dot state={it.state} />
              <span className="font-medium text-neutral-700">{it.label}</span>
              <span className="tabular-nums text-neutral-500">
                {it.data_age_min != null ? fmtMin(it.data_age_min) : "no recent data"}
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
              cron: {it.cron_age_min != null ? fmtMin(it.cron_age_min) : "never"}
            </div>
            <div className="ml-3 mt-0.5">
              <UpdateButton source={it.source as Parameters<typeof UpdateButton>[0]["source"]} label={it.label} />
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
