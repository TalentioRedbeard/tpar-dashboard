// Local weather on My Day (Danny 2026-07-14): 7-day + hourly, iPhone-style —
// "could help the guys plan and keep weather under consideration for planning
// (important and easy to forget in plumbing)". Plumbing-aware callouts: freeze
// hours (burst risk / outdoor work) and rain windows get a highlighted line.
//
// Source: Open-Meteo (keyless, no secret to manage). Server component; the
// fetch caches 30 min (one API call per half hour for the whole team) and the
// card renders nothing on failure — weather must never break /me. Location is
// the shop (Tulsa) — the whole team works the metro; no geolocation prompts.

const SHOP_LAT = 36.1526;
const SHOP_LNG = -95.9711;

type Meteo = {
  current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number; wind_speed_10m?: number };
  hourly?: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; weather_code: number[] };
  daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] };
};

// WMO weather codes → emoji + words.
function wx(code: number | undefined): { e: string; label: string } {
  const c = code ?? -1;
  if (c === 0) return { e: "☀️", label: "Clear" };
  if (c === 1 || c === 2) return { e: "🌤️", label: "Partly cloudy" };
  if (c === 3) return { e: "☁️", label: "Overcast" };
  if (c === 45 || c === 48) return { e: "🌫️", label: "Fog" };
  if (c >= 51 && c <= 57) return { e: "🌦️", label: "Drizzle" };
  if (c >= 61 && c <= 67) return { e: "🌧️", label: "Rain" };
  if (c >= 71 && c <= 77) return { e: "🌨️", label: "Snow" };
  if (c >= 80 && c <= 82) return { e: "🌦️", label: "Showers" };
  if (c === 85 || c === 86) return { e: "🌨️", label: "Snow showers" };
  if (c >= 95) return { e: "⛈️", label: "Thunderstorms" };
  return { e: "🌡️", label: "—" };
}

function hourLabel(iso: string): string {
  const h = Number(iso.slice(11, 13));
  if (h === 0) return "12A";
  if (h === 12) return "12P";
  return h < 12 ? `${h}A` : `${h - 12}P`;
}

function dayLabel(iso: string, idx: number): string {
  if (idx === 0) return "Today";
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

export async function WeatherCard() {
  let data: Meteo | null = null;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${SHOP_LAT}&longitude=${SHOP_LNG}` +
      `&timezone=America%2FChicago&temperature_unit=fahrenheit&wind_speed_unit=mph` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m` +
      `&hourly=temperature_2m,precipitation_probability,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&forecast_days=7`;
    const r = await fetch(url, { next: { revalidate: 1800 }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    data = (await r.json()) as Meteo;
  } catch {
    return null;
  }
  if (!data?.current || !data.hourly || !data.daily) return null;

  const cur = data.current;
  const curWx = wx(cur.weather_code);

  // Hourly: from the current hour, next 24.
  const nowIso = new Date().toLocaleString("sv-SE", { timeZone: "America/Chicago" }).slice(0, 13);
  let startIdx = data.hourly.time.findIndex((t) => t.slice(0, 13) >= nowIso);
  if (startIdx < 0) startIdx = 0;
  const hours = data.hourly.time.slice(startIdx, startIdx + 24).map((t, i) => ({
    t,
    temp: Math.round(data.hourly!.temperature_2m[startIdx + i]),
    pop: data.hourly!.precipitation_probability[startIdx + i] ?? 0,
    code: data.hourly!.weather_code[startIdx + i],
  }));

  // Plumbing callouts over the next 36 hours: freeze + strong rain window.
  const next36 = data.hourly.time.slice(startIdx, startIdx + 36).map((t, i) => ({
    t,
    temp: data.hourly!.temperature_2m[startIdx + i],
    pop: data.hourly!.precipitation_probability[startIdx + i] ?? 0,
  }));
  const freeze = next36.filter((h) => h.temp <= 32);
  const rainStart = next36.find((h) => h.pop >= 60);
  const callouts: Array<{ e: string; text: string }> = [];
  if (freeze.length) {
    const coldest = freeze.reduce((a, b) => (a.temp < b.temp ? a : b));
    callouts.push({
      e: "❄️",
      text: `Freeze ahead — down to ${Math.round(coldest.temp)}°F around ${hourLabel(coldest.t)}${coldest.t.slice(0, 10) !== nowIso.slice(0, 10) ? " tomorrow" : ""}. Think exposed lines, hose bibs, crawl spaces.`,
    });
  }
  if (rainStart) {
    const rainEnd = [...next36].reverse().find((h) => h.pop >= 60);
    callouts.push({
      e: "🌧️",
      text: `Rain likely ${hourLabel(rainStart.t)}–${rainEnd ? hourLabel(rainEnd.t) : ""}${rainStart.t.slice(0, 10) !== nowIso.slice(0, 10) ? " tomorrow" : ""} (${Math.max(...next36.map((h) => h.pop))}%). Plan outdoor digs and trench work around it.`,
    });
  }

  const days = data.daily.time.map((t, i) => ({
    t,
    label: dayLabel(t, i),
    code: data.daily!.weather_code[i],
    hi: Math.round(data.daily!.temperature_2m_max[i]),
    lo: Math.round(data.daily!.temperature_2m_min[i]),
    pop: data.daily!.precipitation_probability_max[i] ?? 0,
  }));

  return (
    <section className="mb-6 rounded-2xl border-2 border-brand-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-3xl leading-none" aria-hidden>{curWx.e}</span>
        <div>
          <div className="text-2xl font-bold text-neutral-900">
            {Math.round(cur.temperature_2m ?? 0)}°
            <span className="ml-2 text-sm font-medium text-neutral-600">{curWx.label}</span>
          </div>
          <div className="text-xs text-neutral-500">
            Feels like {Math.round(cur.apparent_temperature ?? 0)}° · wind {Math.round(cur.wind_speed_10m ?? 0)} mph · Tulsa
          </div>
        </div>
      </div>

      {callouts.map((c, i) => (
        <div key={i} className="mt-2 rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-900 ring-1 ring-inset ring-sky-200">
          {c.e} {c.text}
        </div>
      ))}

      {/* Hourly strip — horizontal scroll, iPhone-style */}
      <div className="mt-3 overflow-x-auto">
        <div className="flex gap-1 pb-1">
          {hours.map((h, i) => (
            <div key={h.t} className="flex w-12 shrink-0 flex-col items-center rounded-lg py-1.5 text-center odd:bg-neutral-50">
              <span className="text-[10px] font-medium text-neutral-500">{i === 0 ? "Now" : hourLabel(h.t)}</span>
              <span className="text-base leading-tight" aria-hidden>{wx(h.code).e}</span>
              <span className={`text-xs font-semibold ${h.temp <= 32 ? "text-sky-600" : "text-neutral-900"}`}>{h.temp}°</span>
              <span className={`text-[9px] ${h.pop >= 40 ? "font-semibold text-sky-600" : "text-neutral-300"}`}>
                {h.pop >= 20 ? `${h.pop}%` : " "}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 7-day */}
      <div className="mt-2 divide-y divide-neutral-100 border-t border-neutral-100">
        {days.map((d) => (
          <div key={d.t} className="flex items-center gap-3 py-1.5 text-sm">
            <span className="w-12 shrink-0 font-medium text-neutral-800">{d.label}</span>
            <span className="w-6 text-center" aria-hidden>{wx(d.code).e}</span>
            <span className={`w-10 text-right text-xs ${d.pop >= 40 ? "font-semibold text-sky-600" : "text-neutral-400"}`}>
              {d.pop >= 20 ? `${d.pop}%` : ""}
            </span>
            <span className="ml-auto flex items-center gap-2 tabular-nums">
              <span className={`${d.lo <= 32 ? "font-semibold text-sky-600" : "text-neutral-400"}`}>{d.lo}°</span>
              <span className="font-semibold text-neutral-900">{d.hi}°</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
