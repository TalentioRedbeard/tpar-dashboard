// /ask — natural-language ops Q&A. Mirrors the Slack /ask command for the
// dashboard. Posts to the ask-tpar edge function with the user's session
// JWT so ask-tpar applies the same role gating as the Slack version
// (admin → KPIs / cross-tech; tech → own data only; allowlisted office
// users get their lane).

import { PageShell } from "../../components/PageShell";
import { Section } from "../../components/ui/Section";
import { EmptyState } from "../../components/ui/EmptyState";
import { Pill } from "../../components/ui/Pill";
import { AskResult, type RoutePlan } from "../../components/AskResult";
import { supabaseServer } from "../../lib/supabase-server";

export const metadata = { title: "Ask · TPAR-DB" };
export const dynamic = "force-dynamic";

const ASK_TPAR_URL = `${process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ask-tpar`;
const ROUTE_URL = `${process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/appguide-route`;

type AskTparResult = {
  ok: boolean;
  intent?: string;
  answer?: string;
  request_id?: string;
  error?: string;
};

type RouteResult = {
  ok: boolean;
  plan?: RoutePlan;
  rows?: Record<string, unknown>[];
  sql_error?: string;
  error?: string;
};

async function askTpar(question: string): Promise<AskTparResult> {
  const supa = await supabaseServer();
  const { data: sessionData } = await supa.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? null;
  if (!accessToken) return { ok: false, error: "not signed in" };

  try {
    const res = await fetch(ASK_TPAR_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ question }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json?.error ?? `ask-tpar ${res.status}` };
    }
    return json as AskTparResult;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Lightweight Slack-mrkdwn → HTML-ish rendering. Good enough for /ask
// answers which use *bold*, _italic_, `code`, and bullet/numbered lists.
function renderAnswer(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Slack `code` → <code>
    .replace(/`([^`]+)`/g, '<code class="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">$1</code>')
    // Slack *bold* → <strong>
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1<strong>$2</strong>')
    // Slack _italic_ → <em>  (wrapped to avoid eating snake_case)
    .replace(/(^|\s)_([^_\n]+)_(\s|[.,;:!?]|$)/g, '$1<em>$2</em>$3');
}

async function routeQuery(question: string): Promise<RouteResult> {
  const supa = await supabaseServer();
  const { data: sessionData } = await supa.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? null;
  if (!accessToken) return { ok: false, error: "not signed in" };
  try {
    const res = await fetch(ROUTE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken}` },
      body: JSON.stringify({ question }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error ?? `appguide-route ${res.status}` };
    return json as RouteResult;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  // Call the structured router first (~6s). If it returns kind=map/table with
  // rows, skip ask-tpar entirely (it's slow — the legacy 4k-line NL backend
  // takes ~80s for the same question). Only fall through to ask-tpar when the
  // router decided this is a text-only question.
  const routeRes = q ? await routeQuery(q) : null;
  const preferStructured = !!(
    routeRes?.ok && routeRes.plan && (routeRes.plan.kind === "map" || routeRes.plan.kind === "table") && (routeRes.rows?.length ?? 0) > 0
  );
  const result = !preferStructured && q ? await askTpar(q) : null;

  return (
    <PageShell
      kicker="Tool · /ask"
      title="Ask TPAR"
      description="Natural-language ops queries against the live system. Same backend as Slack /ask — your role determines what you can see (admin → all data; tech → your own; manager → all read-only)."
    >
      <form className="mb-6 flex flex-wrap items-stretch gap-2" role="search">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="e.g. how many appointments today, who has the most open follow-ups, my jobs this week"
          className="flex-1 min-w-64 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          autoFocus
        />
        <button
          type="submit"
          className="rounded-md bg-brand-700 px-5 py-2 text-sm font-medium text-white hover:bg-brand-800"
        >
          Ask
        </button>
      </form>

      {!q && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 text-sm text-neutral-700">
          <p className="mb-2 font-medium text-neutral-900">Try one of these:</p>
          <ul className="space-y-1.5 text-neutral-600">
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">show me today&apos;s appointments</code></li>
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">customers with the most open follow-ups</code></li>
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">my jobs this week</code></li>
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">how is Anthony doing this month</code></li>
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">recent comms about leaks</code></li>
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">help</code> — full guide of what /ask can do</li>
          </ul>
        </div>
      )}

      {q && preferStructured && routeRes?.plan && (
        <Section>
          <AskResult plan={routeRes.plan} rows={routeRes.rows ?? []} sqlError={routeRes.sql_error ?? null} />
        </Section>
      )}

      {q && result && !preferStructured && (
        <Section>
          {result.ok && result.answer ? (
            <div className="rounded-2xl border border-neutral-200 bg-white p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                {result.intent ? <Pill tone="brand">{result.intent.replace(/_/g, " ")}</Pill> : null}
                {result.request_id ? (
                  <span className="font-mono text-[10px] text-neutral-400">req {result.request_id.slice(0, 8)}</span>
                ) : null}
                <span className="ml-auto">
                  Powered by <code className="font-mono">ask-tpar</code> · same backend as Slack /ask
                </span>
              </div>
              <div
                className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed text-neutral-800"
                dangerouslySetInnerHTML={{ __html: renderAnswer(result.answer) }}
              />
            </div>
          ) : (
            <EmptyState
              title="Couldn't get an answer."
              description={result.error ?? "Something went wrong. Try a different phrasing or check that you're signed in."}
            />
          )}
        </Section>
      )}

      <p className="mt-8 text-xs text-neutral-500">
        Answers come from the live database (job_360, customer_360, communication_events, etc.) and are
        scoped to your role: techs see only their own work; managers and admins see across the team. Type
        <code className="mx-1 rounded bg-neutral-100 px-1 py-0.5 font-mono">help</code> for the full intent guide.
      </p>
    </PageShell>
  );
}
