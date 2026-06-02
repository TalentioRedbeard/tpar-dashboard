"use client";

// Day navigator for the /dispatch/today timeline. Prev / native date-picker /
// next, plus a "Today" jump. Navigates via ?date=YYYY-MM-DD (server reads it).
// Date math is done in UTC on the y-m-d parts so DST never shifts the day.

import { useRouter } from "next/navigation";

const CHI = "America/Chicago";

function shiftYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export function TimelineDayNav({ date, isToday }: { date: string; isToday: boolean }) {
  const router = useRouter();
  const go = (ymd: string) => router.push(`/dispatch/today?date=${ymd}`);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: CHI });

  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => go(shiftYmd(date, -1))} title="Previous day"
        className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm leading-none text-neutral-700 hover:bg-neutral-50">‹</button>
      <input type="date" value={date}
        onChange={(e) => { if (e.target.value) go(e.target.value); }}
        className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-800" />
      <button type="button" onClick={() => go(shiftYmd(date, 1))} title="Next day"
        className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm leading-none text-neutral-700 hover:bg-neutral-50">›</button>
      {isToday ? (
        <span className="ml-1 rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">Today</span>
      ) : (
        <button type="button" onClick={() => go(today)}
          className="ml-1 rounded-md border border-brand-300 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">Today</button>
      )}
    </div>
  );
}
