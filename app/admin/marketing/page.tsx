// /admin/marketing — Phase 1 marketing intelligence.
//
// Reads from data we already have (CallRail webhook events, communication
// events, customer/job data). No new integrations yet. Surfaces the questions
// that actually pay rent: which channels convert? where's spend leaking?
// who picks up the phone vs misses?
//
// Phase 2 will add GMB, Google Ads, LSA API data once we know what to ask.

import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { getSessionUser } from "../../../lib/supabase-server";
import { isAdmin } from "../../../lib/admin";
import { PageShell } from "../../../components/PageShell";
import { Section } from "../../../components/ui/Section";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing · Admin · TPAR-DB" };

type SourceRow = {
  source: string;
  calls: number;
  pct_answered: number;
  pct_first_call: number;
  avg_dur_sec: number;
};

type HourRow = {
  hour_chi: number;
  total_calls: number;
  answered: number;
  pct_answered: number;
};

type CityRow = {
  callercity: string;
  calls: number;
  first_calls: number;
};

async function rpc<T>(supa: ReturnType<typeof db>, sql: string): Promise<T[]> {
  const { data, error } = await supa.rpc("mcp_query_readonly", { query_text: sql });
  if (error) {
    console.error("marketing query error:", error.message);
    return [];
  }
  return (data ?? []) as T[];
}

export default async function MarketingPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");

  const supa = db();

  const sourcesP = rpc<SourceRow>(supa, `
    SELECT
      COALESCE(NULLIF(payload->>'source',''), '(empty)') AS source,
      count(*) AS calls,
      round(100.0 * count(*) FILTER (WHERE (payload->>'answered')::boolean = true) / count(*), 1) AS pct_answered,
      round(100.0 * count(*) FILTER (WHERE (payload->>'first_call')::boolean = true) / count(*), 1) AS pct_first_call,
      round(avg((payload->>'duration')::int) FILTER (WHERE (payload->>'duration')::int > 0)) AS avg_dur_sec
    FROM callrail_webhook_events_raw
    WHERE event_type = 'post_call' AND received_at > now() - interval '90 days'
    GROUP BY 1 HAVING count(*) >= 10 ORDER BY calls DESC
  `);

  const hoursP = rpc<HourRow>(supa, `
    SELECT
      EXTRACT(hour FROM received_at AT TIME ZONE 'America/Chicago')::int AS hour_chi,
      count(*) AS total_calls,
      count(*) FILTER (WHERE (payload->>'answered')::boolean = true) AS answered,
      round(100.0 * count(*) FILTER (WHERE (payload->>'answered')::boolean = true) / count(*), 1) AS pct_answered
    FROM callrail_webhook_events_raw
    WHERE event_type = 'post_call' AND received_at > now() - interval '90 days'
    GROUP BY 1 ORDER BY 1
  `);

  const citiesP = rpc<CityRow>(supa, `
    SELECT
      COALESCE(NULLIF(payload->>'callercity',''),'(unknown)') AS callercity,
      count(*) AS calls,
      count(*) FILTER (WHERE (payload->>'first_call')::boolean = true) AS first_calls
    FROM callrail_webhook_events_raw
    WHERE event_type='post_call' AND received_at > now() - interval '90 days'
    GROUP BY 1 HAVING count(*) >= 5 ORDER BY calls DESC LIMIT 20
  `);

  const [sources, hours, cities] = await Promise.all([sourcesP, hoursP, citiesP]);

  const TULSA_METRO = new Set(["Tulsa", "Broken Arrow", "Jenks", "Bartlesville", "Owasso", "Sand Springs", "Sapulpa", "Bixby", "Glenpool", "Catoosa", "Claremore", "Skiatook", "Coweta", "Wagoner"]);
  const tulsaMetroCalls = cities.filter((c) => TULSA_METRO.has(c.callercity)).reduce((s, c) => s + c.calls, 0);
  const otherCalls = cities.filter((c) => !TULSA_METRO.has(c.callercity)).reduce((s, c) => s + c.calls, 0);

  return (
    <PageShell
      kicker="Admin"
      title="Marketing intelligence"
      description={
        <>
          Phase 1 — what the data already tells us. Source attribution from CallRail webhooks (last 90 days). Phase 2 layers GMB + Google Ads + LSA APIs once we know what questions to ask.
        </>
      }
      backHref="/admin"
      backLabel="Admin home"
    >
      <Section title="Channel deep-dives" description="Per-channel views with their own data + dispute candidates.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <a
            href="/admin/marketing/lsa"
            className="group rounded-xl border border-neutral-200 bg-white p-4 transition-all hover:border-brand-300 hover:shadow-sm"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500">
              Local Services Ads
            </div>
            <div className="mt-1.5 text-base font-semibold text-neutral-900 group-hover:text-brand-700">
              LSA leads + dispute candidates →
            </div>
            <div className="mt-1.5 text-xs text-neutral-500">
              Mirrored from ads.google.com/local-services-ads. Highlights "Charged but bad-quality" leads worth disputing.
            </div>
          </a>
          <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50/50 p-4 opacity-70">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400">
              Google Business Profile
            </div>
            <div className="mt-1.5 text-base font-semibold text-neutral-500">Coming Phase 2</div>
            <div className="mt-1.5 text-xs text-neutral-400">Reviews, posts, photos, attributes.</div>
          </div>
          <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50/50 p-4 opacity-70">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400">
              Google Ads (paid)
            </div>
            <div className="mt-1.5 text-base font-semibold text-neutral-500">Coming Phase 2</div>
            <div className="mt-1.5 text-xs text-neutral-400">Spend ↔ revenue, day-parting tests.</div>
          </div>
        </div>
      </Section>

      <div className="my-6" />

      <Section
        title="Channel attribution (last 90 days)"
        description="From CallRail's last-touch source. Sources with under 10 calls hidden."
      >
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-2.5">Source</th>
                <th className="px-4 py-2.5 text-right">Calls</th>
                <th className="px-4 py-2.5 text-right">Answered</th>
                <th className="px-4 py-2.5 text-right">First-call %</th>
                <th className="px-4 py-2.5 text-right">Avg duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {sources.map((r) => {
                const ansBad = r.pct_answered < 70;
                return (
                  <tr key={r.source}>
                    <td className="px-4 py-2 font-medium text-neutral-900">{r.source}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.calls.toLocaleString()}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${ansBad ? "text-red-700 font-medium" : "text-neutral-700"}`}>{r.pct_answered}%</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{r.pct_first_call}%</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-500">{Math.round(r.avg_dur_sec)}s</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="my-6" />

      <Section title="Answer rate by hour" description="When calls come in vs when we pick up. Red bands flag hours where we're missing high-value moments.">
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-2.5">Hour (CT)</th>
                <th className="px-4 py-2.5 text-right">Calls</th>
                <th className="px-4 py-2.5 text-right">Answered</th>
                <th className="px-4 py-2.5 text-right">% answered</th>
                <th className="px-4 py-2.5">Bar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {hours.filter((h) => h.total_calls > 0).map((h) => {
                const barW = Math.min(100, Math.round((h.total_calls / Math.max(...hours.map((x) => x.total_calls))) * 100));
                const ansBad = h.pct_answered < 70 && h.total_calls >= 10;
                const ansGood = h.pct_answered >= 85;
                return (
                  <tr key={h.hour_chi}>
                    <td className="px-4 py-1.5 font-mono text-xs text-neutral-700">{String(h.hour_chi).padStart(2, "0")}:00</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{h.total_calls}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{h.answered}</td>
                    <td className={`px-4 py-1.5 text-right tabular-nums ${ansBad ? "text-red-700 font-medium" : ansGood ? "text-emerald-700" : "text-neutral-700"}`}>{h.pct_answered}%</td>
                    <td className="px-4 py-1.5">
                      <div className="h-2 rounded-sm bg-neutral-100">
                        <div
                          className={`h-2 rounded-sm ${ansBad ? "bg-red-500/60" : ansGood ? "bg-emerald-500/60" : "bg-neutral-500/40"}`}
                          style={{ width: `${barW}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="my-6" />

      <Section title="Geographic distribution" description={`Tulsa-metro: ${tulsaMetroCalls.toLocaleString()} calls · out-of-market: ${otherCalls.toLocaleString()} calls. Top 20 cities shown.`}>
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-2.5">City</th>
                <th className="px-4 py-2.5 text-right">Calls</th>
                <th className="px-4 py-2.5 text-right">First-time</th>
                <th className="px-4 py-2.5">Market</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {cities.map((c) => {
                const isMetro = TULSA_METRO.has(c.callercity);
                return (
                  <tr key={c.callercity}>
                    <td className="px-4 py-1.5 font-medium text-neutral-900">{c.callercity}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{c.calls.toLocaleString()}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-neutral-600">{c.first_calls.toLocaleString()}</td>
                    <td className="px-4 py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${isMetro ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>
                        {isMetro ? "Tulsa metro" : "out-of-market"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="my-6" />

      <Section title="What this data is telling us" description="Headline observations. Treat as hypotheses, not orders — see end of page for proposed experiments.">
        <div className="space-y-3 text-sm leading-relaxed text-neutral-800">
          <FindingCard
            tone="red"
            title="Google Ads has a phone-availability leak"
            body="Across 90 days Google Ads pulled meaningful call volume but answered well below other paid channels. Worst hours: late morning + lunch. Each unanswered ad call is paid spend that returned nothing. Three plausible fixes: (a) day-part ads to business hours only, (b) re-route calls during lunch and dispatch handoffs, (c) raise bids only when answer-rate is ≥80%."
          />
          <FindingCard
            tone="emerald"
            title="GMB is the highest-leverage organic channel"
            body="Volume + answer rate + first-call rate all stack. Investing here is direct ROI: weekly posts, prompt review responses, photo refresh, attribute updates (24/7 emergency? bonded?), service-area accuracy. GMB is also the lowest cost-per-action."
          />
          <FindingCard
            tone="amber"
            title='"Lilypad x0882" mystery'
            body="Highest call volume but also weakest answer rate. We need to identify what this CallRail tracking number is wired to (directory listing, retired campaign, vanity number, syndication source). Untangling it will either reveal a high-leverage channel or let us archive a noisy one."
          />
          <FindingCard
            tone="emerald"
            title="Print ads still work"
            body="Average call duration ~3 minutes — those are real conversations, not wrong-number hangups. Don't kill print on a generic budget cut."
          />
          <FindingCard
            tone="amber"
            title="Out-of-market noise"
            body={`A meaningful chunk of CallRail calls come from out-of-Tulsa-metro cities (Houston, Fort Collins, Wichita, etc.). Some are legit out-of-state inquiries; many look like wrong-number traffic on tracking lines. Filtering at the CallRail level (block non-Oklahoma area codes? whisper script?) reduces noise on real business hours.`}
          />
        </div>
      </Section>

      <div className="my-6" />

      <Section title="Proposed experiments — Phase 1" description="Each is small, observable, reversible. Pick what to run.">
        <ol className="space-y-3 text-sm leading-relaxed text-neutral-800">
          <li>
            <strong className="text-neutral-900">Google Ads day-parting trial.</strong> Pause Google Ads outside business hours for 2 weeks. Compare: total calls (should drop slightly), answered calls (shouldn't), conversion to job (should hold). If holding, this is permanent saved spend.
          </li>
          <li>
            <strong className="text-neutral-900">Lunch hour answering bridge.</strong> 11:30–1:00 PM, route Google Ads-tracked calls to a dispatcher's mobile or to a "we'll call you back in 15" recorded message. Test for 2 weeks.
          </li>
          <li>
            <strong className="text-neutral-900">GMB weekly post cadence.</strong> One post per week — service highlight, case study, or seasonal reminder. Measure: GMB call volume month-over-month.
          </li>
          <li>
            <strong className="text-neutral-900">Lilypad audit.</strong> Investigate what CallRail source "Lilypad x0882" is. Once known, decide: lean in or retire.
          </li>
          <li>
            <strong className="text-neutral-900">Out-of-market filter.</strong> Add CallRail whisper or routing rule: non-Oklahoma area codes go to voicemail with a callback CTA. See if real out-of-state leads still surface.
          </li>
        </ol>
        <p className="mt-4 text-xs text-neutral-500">
          Phase 2 layers GMB API (review monitoring, post scheduling), Google Ads API (spend ↔ revenue), and LSA API (cost-per-lead) once we know which experiments to instrument.
        </p>
      </Section>
    </PageShell>
  );
}

function FindingCard({ tone, title, body }: { tone: "red" | "amber" | "emerald"; title: string; body: string }) {
  const cls = tone === "red"
    ? "border-red-200 bg-red-50/50"
    : tone === "amber"
      ? "border-amber-200 bg-amber-50/50"
      : "border-emerald-200 bg-emerald-50/50";
  const dot = tone === "red" ? "bg-red-500" : tone === "amber" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <div>
          <div className="font-semibold text-neutral-900">{title}</div>
          <p className="mt-1 text-neutral-700">{body}</p>
        </div>
      </div>
    </div>
  );
}
