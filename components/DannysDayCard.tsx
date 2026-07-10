// Danny's Day — shows techs where Danny is per his TPAR Structure calendar.
// Scheduled-from-calendar only (no GPS); work hours only; unknown blocks
// render as "Busy" (privacy model lives in lib/dannys-day.ts). Async server
// component — mount inside <Suspense> so the Google round-trip never slows /me.
import { getDannysDay } from "../lib/dannys-day";

export async function DannysDayCard() {
  const day = await getDannysDay();
  if (!day) return null;

  return (
    <section className="mb-6">
      <div className="rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="flex items-start gap-3">
          <span aria-hidden className="text-3xl leading-none">🧭</span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-500">
              Danny&apos;s day
            </div>
            <div className="mt-0.5 text-sm font-bold text-brand-900">{day.nowLine}</div>
            {day.blocks.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {day.blocks.map((b, i) => (
                  <li
                    key={i}
                    className={`text-xs ${
                      b.state === "now"
                        ? "font-semibold text-brand-900"
                        : b.state === "past"
                        ? "text-neutral-400"
                        : "text-neutral-600"
                    }`}
                  >
                    <span className="tabular-nums">{b.timeLabel}</span> · {b.label}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-xs text-neutral-500">
              From his work calendar, weekdays 8–5. Need him now? Use the message card below.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
