// Danny's Day — tech-facing read of Danny's "TPAR Structure" calendar.
// This is deliberately the scheduled-from-calendar version (Option A): NO live
// GPS is read here, ever — the personal-vehicle wall stays intact, and the
// card can never go stale-and-wrong the way a location dot can.
//
// Privacy model: only known-team-safe titles render verbatim (the seeded
// structure blocks, or events tagged "[team]" — tag is stripped on display);
// everything else renders as "Busy". The primary calendar is never read
// (the gcal structure_day action only touches the Structure calendar).
//
// Guide surface, never load-bearing: any failure returns null and the card
// simply doesn't render. Work-hours gate: weekdays 8:00–17:00 Chicago.

const GCAL_URL = `${process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/gcal`;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const CHI = "America/Chicago";

export type DannyBlock = {
  label: string;
  timeLabel: string;
  state: "past" | "now" | "later";
};

export type DannysDay = {
  nowLine: string;
  blocks: DannyBlock[];
};

type StructureItem = { title: string; start: string; end: string; all_day: boolean };

const SAFE_PREFIXES = ["🌅", "🌇"];
const TEAM_TAG = /\[team\]/i;

function publicLabel(title: string): string {
  const t = title.trim();
  if (SAFE_PREFIXES.some((p) => t.startsWith(p))) return t;
  if (TEAM_TAG.test(t)) return t.replace(TEAM_TAG, "").replace(/\s+/g, " ").trim();
  return "Busy";
}

function fmtChi(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: CHI, hour: "numeric", minute: "2-digit" });
}

export async function getDannysDay(): Promise<DannysDay | null> {
  // Work-hours gate — outside weekday 8–5 Chicago the card doesn't exist.
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHI, weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hr = Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
  if (wd === "Sat" || wd === "Sun" || hr < 8 || hr >= 17) return null;
  if (!SERVICE_KEY) return null;

  try {
    const res = await fetch(GCAL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "apikey": SERVICE_KEY,
      },
      body: JSON.stringify({ action: "structure_day" }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; items?: StructureItem[] } | null;
    if (!res.ok || !j?.ok) return null;

    const items = (j.items ?? []).filter((it) => it.start);
    const nowMs = now.getTime();

    const blocks: DannyBlock[] = items.map((it) => {
      const startMs = it.all_day ? NaN : new Date(it.start).getTime();
      const endMs = it.all_day ? NaN : new Date(it.end).getTime();
      const state: DannyBlock["state"] = it.all_day
        ? "later"
        : nowMs >= endMs
        ? "past"
        : nowMs >= startMs
        ? "now"
        : "later";
      return {
        label: publicLabel(it.title),
        timeLabel: it.all_day ? "All day" : `${fmtChi(it.start)}–${fmtChi(it.end)}`,
        state,
      };
    });

    const current = blocks.find((b) => b.state === "now");
    const next = items.find((it) => !it.all_day && new Date(it.start).getTime() > nowMs);
    const nowLine = current
      ? `Now: ${current.label}`
      : next
      ? `Next: ${publicLabel(next.title)} at ${fmtChi(next.start)}`
      : blocks.length > 0
      ? "Calendar is clear for the rest of the day"
      : "No schedule posted today";

    return { nowLine, blocks };
  } catch {
    return null;
  }
}
