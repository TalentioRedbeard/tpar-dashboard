// /me/coaching — self-coaching surface for techs (esp. Madisson + leads).
//
// Per Danny 2026-05-14: "the system invites, doesn't compel." She opens it
// because watching her own conversion improve is interesting on its own.
//
// What it shows:
//   - Last 10 calls (audio link + transcript + sentiment + importance + customer)
//   - This week's call→appt conversion vs last week
//   - Aged unacked high-importance comms she owns
//   - The teaching tape (Velvet Taco call id 2503) linked inline
//   - How we price (doctrine principle + live money ladder from field_doctrine
//     + data-earned standard-rates strip from standard_line_rates_v, tolerant of absence)
//   - The diagnostic-ladder intake questions as a printable reference
//
// Reads from communication_events + appointments_master + field_doctrine. No new tables.

import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "../../../lib/supabase";
import { getCurrentTech } from "../../../lib/current-tech";
import { PageShell } from "../../../components/PageShell";
import { ScrollPanel } from "../../../components/ui/ScrollPanel";

export const metadata = { title: "My coaching · TPAR-DB" };
export const dynamic = "force-dynamic";

const TEACHING_TAPE_ID = 2503; // Danny's Velvet Taco call — 5-move template

type CommRow = {
  id: number;
  occurred_at: string;
  channel: string | null;
  direction: string | null;
  customer_name: string | null;
  hcp_customer_id: string | null;
  importance: number | null;
  sentiment: string | null;
  flags: string[] | null;
  summary: string | null;
};

function fmtChi(s: string): string {
  return new Date(s).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function sentimentTone(s: string | null): string {
  if (s === "positive") return "bg-emerald-100 text-emerald-800";
  if (s === "negative") return "bg-red-100 text-red-800";
  if (s === "neutral")  return "bg-neutral-100 text-neutral-700";
  return "bg-neutral-50 text-neutral-500";
}

function impTone(imp: number | null): string {
  if (imp == null) return "bg-neutral-50 text-neutral-500";
  if (imp >= 8) return "bg-red-100 text-red-800";
  if (imp === 7) return "bg-amber-100 text-amber-800";
  if (imp >= 5) return "bg-neutral-100 text-neutral-700";
  return "bg-neutral-50 text-neutral-500";
}

export default async function CoachingPage() {
  const me = await getCurrentTech();
  if (!me?.tech?.tech_short_name) redirect("/login?from=/me/coaching");

  const techShort = me.tech.tech_short_name;
  const supa = db();

  const weekStart = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const lastWeekStart = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [
    recentCallsRes,
    thisWeekCallsRes,
    lastWeekCallsRes,
    agedUnackedRes,
    teachingTapeRes,
    ratesRes,
    moneyLadderRes,
  ] = await Promise.all([
    // Last 10 calls (any channel, any direction, real customer comms only)
    supa
      .from("communication_events")
      .select("id, occurred_at, channel, direction, customer_name, hcp_customer_id, importance, sentiment, flags, summary")
      .eq("tech_short_name", techShort)
      .or("direction.is.null,direction.neq.internal")
      .order("occurred_at", { ascending: false })
      .limit(10),

    // This week: calls with hcp_customer_id (so we can measure conversion)
    supa
      .from("communication_events")
      .select("id, occurred_at, hcp_customer_id")
      .eq("tech_short_name", techShort)
      .eq("channel", "call")
      .gte("occurred_at", weekStart)
      .not("hcp_customer_id", "is", null),

    // Last week: same shape for comparison
    supa
      .from("communication_events")
      .select("id, occurred_at, hcp_customer_id")
      .eq("tech_short_name", techShort)
      .eq("channel", "call")
      .gte("occurred_at", lastWeekStart)
      .lt("occurred_at", weekStart)
      .not("hcp_customer_id", "is", null),

    // Aged unacked imp>=7 owned by this tech
    supa
      .from("communication_events")
      .select("id, occurred_at, customer_name, importance, summary")
      .eq("tech_short_name", techShort)
      .is("acked_at", null)
      .gte("importance", 7)
      .lt("occurred_at", dayAgo)
      .gte("occurred_at", monthAgo)
      .or("direction.is.null,direction.neq.internal")
      .order("importance", { ascending: false })
      .order("occurred_at", { ascending: false })
      .limit(20),

    // The teaching tape — pull it fresh so we can render its summary inline
    supa
      .from("communication_events")
      .select("id, occurred_at, customer_name, summary, importance")
      .eq("id", TEACHING_TAPE_ID)
      .maybeSingle(),

    // Internal rate card snapshot — read-off reference for mid-call moments.
    supa
      .from("internal_rate_card")
      .select("rate_key, category, display_name, unit, amount_cents, scope_notes")
      .eq("is_active", true)
      .order("category")
      .order("amount_cents", { ascending: false }),

    // Money ladder — LIVE from field_doctrine (single source of truth;
    // doctrine edits propagate here automatically). Renders "How we price".
    supa
      .from("field_doctrine")
      .select("ord, title, rule, icon")
      .eq("section", "money_ladder")
      .eq("active", true)
      .order("ord"),
  ]);

  const recentCalls = (recentCallsRes.data ?? []) as CommRow[];
  const thisWeekCalls = (thisWeekCallsRes.data ?? []) as Array<{ occurred_at: string; hcp_customer_id: string }>;
  const lastWeekCalls = (lastWeekCallsRes.data ?? []) as Array<{ occurred_at: string; hcp_customer_id: string }>;
  const agedRows = (agedUnackedRes.data ?? []) as Array<{ id: number; occurred_at: string; customer_name: string | null; importance: number; summary: string | null }>;
  const teachingTape = teachingTapeRes.data as { id: number; occurred_at: string; customer_name: string | null; summary: string | null; importance: number } | null;
  const rates = (ratesRes.data ?? []) as Array<{ rate_key: string; category: string; display_name: string; unit: "flat"|"hour"|"percent"|"each"; amount_cents: number; scope_notes: string | null }>;
  const moneyLadder = (moneyLadderRes.data ?? []) as Array<{ ord: number; title: string; rule: string; icon: string | null }>;

  function fmtRate(unit: "flat"|"hour"|"percent"|"each", cents: number): string {
    if (unit === "percent") return `${cents}%`;
    const d = cents / 100;
    if (unit === "flat") return `$${d.toFixed(0)}`;
    if (unit === "hour") return `$${d.toFixed(0)}/hr`;
    return `$${d.toFixed(2)}`;
  }

  // Compute conversion: did an appointment get scheduled for the customer within 48h of the call?
  async function conversionFor(rows: Array<{ occurred_at: string; hcp_customer_id: string }>): Promise<{ total: number; converted: number; pct: number }> {
    if (rows.length === 0) return { total: 0, converted: 0, pct: 0 };
    const custIds = Array.from(new Set(rows.map((r) => r.hcp_customer_id)));
    const { data: appts } = await supa
      .from("appointments_master")
      .select("hcp_customer_id, scheduled_start, status")
      .is("deleted_at", null)
      .in("hcp_customer_id", custIds)
      .not("status", "in", '("user canceled","pro canceled")');
    const byCust = new Map<string, string[]>();
    for (const a of (appts ?? []) as Array<{ hcp_customer_id: string; scheduled_start: string }>) {
      const arr = byCust.get(a.hcp_customer_id) ?? [];
      arr.push(a.scheduled_start);
      byCust.set(a.hcp_customer_id, arr);
    }
    let converted = 0;
    for (const r of rows) {
      const apps = byCust.get(r.hcp_customer_id) ?? [];
      const callMs = new Date(r.occurred_at).getTime();
      const has48h = apps.some((s) => {
        const apptMs = new Date(s).getTime();
        return apptMs >= callMs && apptMs <= callMs + 48 * 3_600_000;
      });
      if (has48h) converted++;
    }
    return { total: rows.length, converted, pct: Math.round(100 * converted / rows.length * 10) / 10 };
  }

  // STANDARD RATES — data-earned medians of what line items actually total.
  // The view (standard_line_rates_v) may not exist yet (lands separately) —
  // on ANY failure (missing view, network) the strip simply doesn't render.
  type StandardRateRow = { item_key: string; n_lines: number; median_total_dollars: number | string | null };
  let standardRates: StandardRateRow[] = [];
  try {
    const { data, error } = await supa
      .from("standard_line_rates_v")
      .select("item_key, n_lines, median_total_dollars")
      .gte("n_lines", 5)
      .order("n_lines", { ascending: false })
      .limit(10);
    if (!error && data) {
      standardRates = (data as StandardRateRow[]).filter((r) => Number.isFinite(Number(r.median_total_dollars)));
    }
  } catch {
    // view not created yet — render nothing
  }

  const thisWeek = await conversionFor(thisWeekCalls);
  const lastWeek = await conversionFor(lastWeekCalls);
  const delta = Math.round((thisWeek.pct - lastWeek.pct) * 10) / 10;

  // Pattern-drift alert: count calls in last 7d with "have danny" or "have him give you a call" pattern
  const driftCount = recentCalls.filter((c) => {
    const s = (c.summary ?? "").toLowerCase();
    return s.includes("have danny") || s.includes("have him give you a call") || s.includes("will give you a call back");
  }).length;

  return (
    <PageShell
      title="My coaching"
      description="Your last 10 calls, your conversion this week, and the moves to add."
      backHref="/me"
      backLabel="My day"
      help={{
        intent: "Your own mirror. Recent calls + this week's numbers + the teaching tape. Optional, not required.",
        actions: [
          "Top strip shows this-week vs. last-week conversion. Up is good, down is a nudge.",
          "Teaching tape is Danny's Velvet Taco call — listen to the 5 moves.",
          "Rate card foldable holds the factor inputs — hours × rate + materials + modifiers make the price.",
          "Recent calls list links to /comms/{id} for the full transcript + audio.",
        ],
        stuck: <>Conversion looks weirdly low? Could be calls not linked to appointments yet — they catch up overnight.</>,
      }}
    >
      {/* TOP STRIP — conversion + aged + drift */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">This week</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{thisWeek.pct}%</div>
          <div className="text-xs text-neutral-500">{thisWeek.converted} of {thisWeek.total} calls → appt within 48h</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Last week</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{lastWeek.pct}%</div>
          <div className="text-xs text-neutral-500">
            {delta > 0 ? <span className="text-emerald-700">+{delta} pts this week</span> :
             delta < 0 ? <span className="text-red-700">{delta} pts this week</span> :
             <span className="text-neutral-500">no change</span>}
          </div>
        </div>
        <div className={`rounded-2xl border p-3 ${agedRows.length >= 5 ? "border-amber-200 bg-amber-50" : "border-neutral-200 bg-white"}`}>
          <div className={`text-xs uppercase tracking-wide ${agedRows.length >= 5 ? "text-amber-700" : "text-neutral-500"}`}>Aged follow-ups</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${agedRows.length >= 5 ? "text-amber-900" : "text-neutral-900"}`}>{agedRows.length}</div>
          <div className={`text-xs ${agedRows.length >= 5 ? "text-amber-700/80" : "text-neutral-500"}`}>imp ≥ 7 unacked &gt; 24h</div>
        </div>
        <div className={`rounded-2xl border p-3 ${driftCount >= 3 ? "border-amber-200 bg-amber-50" : "border-neutral-200 bg-white"}`}>
          <div className={`text-xs uppercase tracking-wide ${driftCount >= 3 ? "text-amber-700" : "text-neutral-500"}`}>Punt-pattern</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${driftCount >= 3 ? "text-amber-900" : "text-neutral-900"}`}>{driftCount}/10</div>
          <div className={`text-xs ${driftCount >= 3 ? "text-amber-700/80" : "text-neutral-500"}`}>last calls ended &quot;have X call you back&quot;</div>
        </div>
      </div>

      {/* TEACHING TAPE */}
      {teachingTape && (
        <section className="mb-6 rounded-2xl border border-brand-200 bg-brand-50 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-brand-900">📼 Teaching tape — Danny → {teachingTape.customer_name ?? "—"}</h2>
            <span className="text-xs text-brand-700">{fmtChi(teachingTape.occurred_at)} · imp {teachingTape.importance}</span>
          </div>
          <p className="mt-2 text-sm text-brand-900/90">{teachingTape.summary ?? "—"}</p>
          <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-5">
            <div className="rounded-xl bg-white p-2"><strong className="block text-xs uppercase text-brand-700">1. Apologize</strong>before grievance</div>
            <div className="rounded-xl bg-white p-2"><strong className="block text-xs uppercase text-brand-700">2. Frame the why</strong>set up the structure</div>
            <div className="rounded-xl bg-white p-2"><strong className="block text-xs uppercase text-brand-700">3. Count out loud</strong>&quot;three options&quot;</div>
            <div className="rounded-xl bg-white p-2"><strong className="block text-xs uppercase text-brand-700">4. Name recommendation</strong>which one to pick</div>
            <div className="rounded-xl bg-white p-2"><strong className="block text-xs uppercase text-brand-700">5. Show the math</strong>labor vs contingency</div>
          </div>
          <p className="mt-3 text-xs text-brand-900/70">
            Listen to the full call: <Link href={`/comms/${teachingTape.id}`} className="font-medium underline">/comms/{teachingTape.id}</Link>
          </p>
        </section>
      )}

      {/* RATE CARD — mid-call quick reference (admin-edits at /admin/rates) */}
      {rates.length > 0 && (
        <details className="mb-6 rounded-2xl border border-neutral-200 bg-white p-4" open>
          <summary className="cursor-pointer text-sm font-semibold text-neutral-800">
            💵 Rate card — read off, don&apos;t invent
            <span className="ml-2 text-xs font-normal text-neutral-500">internal-only</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rates.map((r) => (
              <div key={r.rate_key} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-neutral-900">{r.display_name}</span>
                  <span className="font-mono tabular-nums text-base font-semibold text-neutral-900">{fmtRate(r.unit, r.amount_cents)}</span>
                </div>
                {r.scope_notes ? (
                  <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">{r.scope_notes}</p>
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-neutral-500">
            These are factor inputs, not job prices — they feed the formula: the price comes from hours × rate + materials + modifiers. Customer-facing posture stays upfront pricing. Edits at <Link href="/admin/rates" className="underline hover:text-neutral-700">/admin/rates</Link>.
          </p>
        </details>
      )}

      {/* HOW WE PRICE — doctrine, not a rates list (replaced the placeholder price ranges, 2026-07-07) */}
      <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="text-base font-semibold text-neutral-800">💰 How we price</h2>
        <p className="mt-2 text-sm text-neutral-700">
          Rates never dictate the price. Price from the actual factors — time, material, and modifiers — with your judgment applied. The result: an up-front price built from the work description.
        </p>
        {moneyLadder.length > 0 && (
          <ol className="mt-3 space-y-1.5">
            {moneyLadder.map((s) => (
              <li key={s.ord} className="flex items-baseline gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
                <span className="w-4 shrink-0 text-center font-mono text-xs font-semibold text-neutral-500" aria-hidden>{s.ord}</span>
                {s.icon ? <span aria-hidden className="shrink-0">{s.icon}</span> : null}
                <span className="shrink-0 font-medium text-neutral-900">{s.title}</span>
                <span className="min-w-0 truncate text-neutral-600">— {s.rule}</span>
              </li>
            ))}
          </ol>
        )}
        {standardRates.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-neutral-800">Standard rates — earned from our own jobs</h3>
            <p className="mt-1 text-xs text-neutral-500">
              Medians of what these line items actually total. Quote them straight under standard conditions; your judgment adjusts the up-front price when the job&apos;s harder than standard.
            </p>
            <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {standardRates.map((r, i) => (
                <li
                  key={`${r.item_key}-${i}`}
                  className="flex items-baseline justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm"
                >
                  <span className="min-w-0 truncate text-neutral-800">{r.item_key}</span>
                  <span className="shrink-0">
                    <strong className="font-mono text-base font-semibold tabular-nums text-neutral-900">
                      ${Math.round(Number(r.median_total_dollars)).toLocaleString("en-US")}
                    </strong>
                    <span className="ml-1.5 text-[11px] text-neutral-400">n={r.n_lines} jobs</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            href="/estimate/new"
            className="inline-flex items-center rounded-xl bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-900"
          >
            Describe the work → Price it with me
          </Link>
          <Link
            href="/how-to#doctrine"
            className="inline-flex items-center rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            The full Field Guide →
          </Link>
        </div>
      </section>

      {/* DIAGNOSTIC LADDER — intake questions (printable) */}
      <details className="mb-6 rounded-2xl border border-neutral-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-neutral-800">
          📋 The intake ladder (printable reference)
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <h3 className="mb-1 font-semibold text-neutral-700">Slow drain</h3>
            <ol className="ml-4 list-decimal space-y-0.5 text-neutral-700">
              <li>One fixture or multiple?</li>
              <li>Kitchen or bath?</li>
              <li>Slow only, or bubbling/gurgling?</li>
              <li>Any smell?</li>
              <li>Tried anything (chemicals, plunger, snake)?</li>
            </ol>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-neutral-700">Toilet</h3>
            <ol className="ml-4 list-decimal space-y-0.5 text-neutral-700">
              <li>Running, leaking, clogged, or wobbly?</li>
              <li>Age of toilet?</li>
              <li>Just this one or multiple?</li>
              <li>Recent work in the area?</li>
            </ol>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-neutral-700">Leak</h3>
            <ol className="ml-4 list-decimal space-y-0.5 text-neutral-700">
              <li>Where&apos;s the water coming from?</li>
              <li>Hot side, cold side, or both?</li>
              <li>Main been shut off? (if not, walk them through it!)</li>
              <li>Constant or intermittent?</li>
              <li>Recent work / pressure / weather change?</li>
            </ol>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-neutral-700">Water heater</h3>
            <ol className="ml-4 list-decimal space-y-0.5 text-neutral-700">
              <li>No hot, not enough, or leaking?</li>
              <li>Gas or electric?</li>
              <li>Age (look at sticker)?</li>
              <li>Location (attic, garage, closet)?</li>
            </ol>
          </div>
          <div className="sm:col-span-2 rounded-xl bg-amber-50 p-3">
            <h3 className="mb-1 font-semibold text-amber-900">Always close with</h3>
            <ul className="ml-4 list-disc space-y-0.5 text-amber-900">
              <li>&quot;Anything else around the house been bugging you?&quot;</li>
              <li>&quot;Want me to have them bring [X] just in case?&quot;</li>
            </ul>
          </div>
        </div>
      </details>

      {/* RECENT CALLS */}
      <section className="mb-6">
        <h2 className="mb-3 text-base font-semibold text-neutral-800">My last 10 comms</h2>
        {recentCalls.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
            No recent comms attributed to {techShort}.
          </div>
        ) : (
          <ul className="space-y-2">
            {recentCalls.map((c) => (
              <li key={c.id} className="rounded-2xl border border-neutral-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                  <span className="text-neutral-600">
                    {fmtChi(c.occurred_at)} · <span className="uppercase">{c.channel ?? "—"}</span>
                    {c.direction ? ` · ${c.direction}` : ""}
                  </span>
                  <span className="flex flex-wrap items-baseline gap-1">
                    <span className={`rounded-md px-1.5 py-0.5 font-medium ${impTone(c.importance)}`}>imp {c.importance ?? "—"}</span>
                    <span className={`rounded-md px-1.5 py-0.5 font-medium ${sentimentTone(c.sentiment)}`}>{c.sentiment ?? "—"}</span>
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  {c.hcp_customer_id ? (
                    <Link href={`/customer/${c.hcp_customer_id}`} className="font-medium text-neutral-900 hover:underline">
                      {c.customer_name ?? "—"}
                    </Link>
                  ) : (
                    <span className="font-medium text-neutral-900">{c.customer_name ?? "—"}</span>
                  )}
                  <Link href={`/comms/${c.id}`} className="text-xs text-brand-700 hover:underline">listen / transcript →</Link>
                </div>
                <div className="mt-1 text-sm text-neutral-700">{c.summary?.slice(0, 280) ?? "—"}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* AGED — your follow-ups */}
      {agedRows.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-neutral-800">
            ⚠ Your aged follow-ups ({agedRows.length})
          </h2>
          <ScrollPanel tier="compact">
          <ul className="space-y-1.5">
            {agedRows.map((r) => {
              const days = Math.floor((Date.now() - new Date(r.occurred_at).getTime()) / 86_400_000);
              return (
                <li key={r.id} className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline gap-2 text-xs text-amber-900/70">
                    <span className="font-mono font-semibold">{days}d old</span>
                    <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">imp {r.importance}</span>
                    <Link href={`/comms/${r.id}`} className="ml-auto text-brand-700 hover:underline">open →</Link>
                  </div>
                  <div className="mt-1 font-medium text-neutral-900">{r.customer_name ?? "—"}</div>
                  <div className="text-xs text-neutral-700">{r.summary?.slice(0, 220) ?? "—"}</div>
                </li>
              );
            })}
          </ul>
          </ScrollPanel>
        </section>
      )}

      <p className="mt-6 text-xs text-neutral-500">
        v1 · 2026-07-07: placeholder price ranges removed — pricing comes from the factors (time, material, modifiers), not a rates list. This page is for you, not your manager. Nobody&apos;s grading. Watch your conversion improve week-over-week and you&apos;ll see what&apos;s working.
      </p>
    </PageShell>
  );
}
