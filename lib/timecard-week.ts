// Shared pay-week + punch-pair helpers for the timecard surfaces
// (/manage/timecards review grid + the tech's own /me/timecard card).
// Pay week is SUNDAY-start in America/Chicago, matching HCP timecards and
// hcp-timecard-sync. Hours are derived from timecard_sync_days.hcp_pairs
// ("HH:MM" Chicago strings) — HCP truth, never tech_time_entries.

export const CHI = "America/Chicago";
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type HcpPair = { in: string | null; out: string | null };

export function chiToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: CHI });
}

export function weekSundayOf(iso: string): string {
  // Sunday-start pay week, matching HCP timecards and the sync.
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function pairHours(pairs: HcpPair[] | null): { hours: number; open: boolean } {
  let mins = 0;
  let open = false;
  for (const p of pairs ?? []) {
    if (!p.in) continue;
    if (!p.out) { open = true; continue; }
    const [ih, im] = p.in.split(":").map(Number);
    const [oh, om] = p.out.split(":").map(Number);
    const d = oh * 60 + om - (ih * 60 + im);
    if (Number.isFinite(d) && d > 0) mins += d;
  }
  return { hours: mins / 60, open };
}

export function fmtHours(h: number): string {
  return h === 0 ? "—" : h.toFixed(h % 1 === 0 ? 0 : 1);
}

export function fmtPair(p: HcpPair): string {
  return `${p.in ?? "?"}–${p.out ?? "(open)"}`;
}
