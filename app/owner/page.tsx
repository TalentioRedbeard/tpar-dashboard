// /owner — the Owner Control Panel (Danny's daily mission-control).
// His words: "as the owner and developer of the app, I should have a control-panel page
// that lets me see and analyze app usage and make adjustments daily... check-in with
// activity, requirement, job cost, and noting requirements for improvement, with the
// ability to make adjustments based on the observed results."
//
// Five sections: (1) activity pulse — is the app being USED and by whom; (2) requirement
// queue — tech-surfaced improvement asks + the owner's own capture; (3) job cost snapshot
// — recent job economics; (4) adjustment levers — the toggles that already exist (doctrine
// gate, app_flags, follow-up engine kill-switch); (5) deep-page links.
//
// VIEW is admin-gated (the /conversation pattern). WRITES are owner-only (each server
// action re-checks requireOwner). MONEY LANDMINE: job_360.revenue + due_amount are DOLLARS.

import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/supabase";
import { getFollowupConfig } from "@/app/dispatch/followup-actions";
import { FollowupConfigPanel } from "@/components/FollowupConfigPanel";
import {
  AddImprovementNoteForm,
  ImprovementNoteControls,
  DoctrineReviewControls,
  AppFlagToggle,
} from "@/components/OwnerPanels";

export const dynamic = "force-dynamic";

// ── formatting helpers ────────────────────────────────────────────────────────
function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
const usd = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(Number(n))}%`);

// Activity-pulse metric presentation (order + label + icon + one-line context).
const PULSE_META: Record<string, { icon: string; label: string; ctx: string }> = {
  ask_interactions: { icon: "✨", label: "Ask usage", ctx: "in-app questions asked" },
  team_pushes: { icon: "📨", label: "Team pushes", ctx: "tech → office/Danny messages" },
  ask_escalations: { icon: "☎️", label: "Phone escalations", ctx: "urgent field escalations" },
  tech_daily_wraps: { icon: "🌙", label: "Daily wraps", ctx: "end-of-day tech recaps" },
  recordings: { icon: "🎙️", label: "Recordings", ctx: "captured audio (by kind)" },
  estimate_sends: { icon: "📄", label: "Estimate sends", ctx: "tracked Resend sends" },
  daily_reviews: { icon: "🧭", label: "Daily reviews", ctx: "auto-distilled day reviews" },
  office_notes: { icon: "🎧", label: "Ambient capture", ctx: "office chunks — capture health" },
};
const PULSE_ORDER = [
  "ask_interactions", "team_pushes", "ask_escalations", "tech_daily_wraps",
  "recordings", "estimate_sends", "daily_reviews", "office_notes",
];

type PulseRow = { metric: string; c7: number; ctoday: number; last_seen: string | null };
type WrapRow = { wrap_date: string; tech: string; requirements: unknown };
type NoteRow = { id: string; note: string; area: string | null; created_at: string; created_by: string | null };
type JobRow = {
  hcp_job_id: string; customer_name: string | null; tech_primary_name: string | null;
  revenue: number | null; due_amount: number | null; days_outstanding: number | null;
  gross_margin_pct: number | null; job_date: string | null; collection_status: string | null;
};
type DoctrineRow = {
  id: string; section: string; title: string; rule: string;
  audience_risk: string | null; risk_note: string | null; provenance: string | null;
};
type FlagRow = { key: string; enabled: boolean; updated_by: string | null; updated_at: string | null };

const LOW_MARGIN = 40; // gross_margin_pct below this = flagged thin job

export default async function OwnerPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");

  // Recent-wrap window for the requirement queue (last 21 calendar days, Chicago).
  const todayChi = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const wrapsCutoff = new Date(Date.parse(todayChi) - 21 * 86_400_000).toISOString().slice(0, 10);

  const [
    pulseRes, recKindRes, wrapsRes, notesRes, jobsRes, doctrineRes, flagsRes, followup,
  ] = await Promise.all([
    db().from("owner_activity_pulse_v").select("*"),
    db().from("recordings").select("target_kind").gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString()),
    db().from("tech_daily_wraps").select("wrap_date, tech, requirements").gte("wrap_date", wrapsCutoff).order("wrap_date", { ascending: false }),
    db().from("owner_improvement_notes").select("id, note, area, created_at, created_by").in("status", ["open", "doing"]).order("created_at", { ascending: false }).limit(50),
    db().from("job_360").select("hcp_job_id, customer_name, tech_primary_name, revenue, due_amount, days_outstanding, gross_margin_pct, job_date, collection_status").gt("revenue", 0).order("job_date", { ascending: false, nullsFirst: false }).limit(20),
    db().from("field_doctrine").select("id, section, title, rule, audience_risk, risk_note, provenance").eq("approved", false).eq("active", true).order("section").order("ord"),
    db().from("app_flags").select("key, enabled, updated_by, updated_at").order("key"),
    getFollowupConfig(),
  ]);

  const pulse = (pulseRes.data ?? []) as PulseRow[];
  const pulseByMetric = new Map(pulse.map((p) => [p.metric, p]));

  // Recordings target_kind breakdown (7d) for the pulse "by kind" context line.
  const recKinds = new Map<string, number>();
  for (const r of (recKindRes.data ?? []) as Array<{ target_kind: string | null }>) {
    const k = r.target_kind ?? "unfiled";
    recKinds.set(k, (recKinds.get(k) ?? 0) + 1);
  }
  const recKindStr = [...recKinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");

  // Requirement queue — flatten tech_daily_wraps.requirements [{area,text}].
  type Req = { tech: string; date: string; area: string; text: string };
  const reqs: Req[] = [];
  for (const w of (wrapsRes.data ?? []) as WrapRow[]) {
    if (!Array.isArray(w.requirements)) continue;
    for (const r of w.requirements as Array<{ area?: string; text?: string }>) {
      const text = String(r?.text ?? "").trim();
      if (!text) continue;
      reqs.push({ tech: w.tech, date: w.wrap_date, area: String(r?.area ?? "other"), text });
    }
  }

  const notes = (notesRes.data ?? []) as NoteRow[];
  const jobs = (jobsRes.data ?? []) as JobRow[];
  const doctrine = (doctrineRes.data ?? []) as DoctrineRow[];
  const flags = (flagsRes.data ?? []) as FlagRow[];

  // Job-cost roll-ups across the fetched recent-revenue set.
  const marginVals = jobs.map((j) => j.gross_margin_pct).filter((v): v is number => v != null);
  const avgMargin = marginVals.length ? marginVals.reduce((a, b) => a + b, 0) / marginVals.length : null;
  const totalOutstanding = jobs.reduce((a, j) => a + (j.due_amount ?? 0), 0);
  const lowMarginCount = jobs.filter((j) => j.gross_margin_pct != null && j.gross_margin_pct < LOW_MARGIN).length;

  const asOf = new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago", hour: "numeric", minute: "2-digit",
  });
  const dateStr = new Date().toLocaleDateString("en-US", {
    timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", year: "numeric",
  });

  const DEEP_LINKS = [
    { href: "/conversation", label: "Conversation" },
    { href: "/context", label: "Context" },
    { href: "/reports", label: "Reports" },
    { href: "/dispatch", label: "Dispatch" },
    { href: "/admin/system", label: "System map" },
    { href: "/admin/usage", label: "Usage" },
  ];

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
      {/* Header */}
      <header className="rounded-2xl border border-neutral-200 border-t-[3px] border-t-gold-500 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold text-navy-900">🎛️ Owner Control</h1>
          <span className="text-xs text-neutral-500">as of {asOf} · {dateStr} · America/Chicago</span>
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          Daily check-in on app <b>activity</b>, tech-surfaced <b>requirements</b>, <b>job cost</b>, and the <b>adjustment levers</b> — see how the app is being used and tune it from one place.
        </p>
        <nav className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {DEEP_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-brand-700 hover:underline">{l.label} →</Link>
          ))}
        </nav>
      </header>

      {/* 1 — Activity pulse */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">1 · Activity pulse</h2>
          <span className="text-[11px] text-neutral-400">7-day + today (America/Chicago) · last-seen</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PULSE_ORDER.map((m) => {
            const meta = PULSE_META[m];
            const row = pulseByMetric.get(m);
            const c7 = row?.c7 ?? 0;
            const ctoday = row?.ctoday ?? 0;
            const last = row?.last_seen ?? null;
            const isAmbient = m === "office_notes";
            const staleMin = last ? (Date.now() - Date.parse(last)) / 60000 : Infinity;
            const ambientTone = isAmbient
              ? staleMin < 15 ? "text-emerald-700" : staleMin < 90 ? "text-amber-700" : "text-neutral-500"
              : "text-neutral-500";
            const ctxLine = m === "recordings" && recKindStr ? recKindStr : meta.ctx;
            return (
              <div key={m} className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5">
                <div className="flex items-center gap-1.5">
                  <span aria-hidden>{meta.icon}</span>
                  <span className="text-xs font-semibold text-neutral-800">{meta.label}</span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-lg font-bold tabular-nums text-navy-900">{c7}</span>
                  <span className="text-[11px] text-neutral-500">7d</span>
                  <span className="text-sm font-semibold tabular-nums text-brand-700">{ctoday}</span>
                  <span className="text-[11px] text-neutral-500">today</span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-neutral-500" title={ctxLine}>{ctxLine}</div>
                <div className={`text-[11px] ${ambientTone}`}>last {ago(last)}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 2 — Requirement queue */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">2 · Requirement queue</h2>
          <span className="text-[11px] text-neutral-400">improvement asks — techs (last 21d) + your own</span>
        </div>

        <AddImprovementNoteForm />

        {/* Owner's open notes */}
        <div className="mt-3">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Your open notes ({notes.length})</h3>
          {notes.length === 0 ? (
            <p className="text-xs text-neutral-400">No open improvement notes.</p>
          ) : (
            <ul className="space-y-1.5">
              {notes.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-800">{n.note}</p>
                    <p className="text-[11px] text-neutral-400">
                      {n.area ? <span className="mr-1 rounded bg-neutral-100 px-1 py-0.5 font-medium text-neutral-600">{n.area}</span> : null}
                      {ago(n.created_at)}
                    </p>
                  </div>
                  <ImprovementNoteControls id={n.id} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Tech-surfaced requirements from daily wraps */}
        <div className="mt-4">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">From tech daily wraps ({reqs.length})</h3>
          {reqs.length === 0 ? (
            <p className="text-xs text-neutral-400">No requirements surfaced in the last 21 days.</p>
          ) : (
            <ul className="space-y-1">
              {reqs.map((r, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-2 rounded-md border border-neutral-100 bg-neutral-50 px-3 py-1.5 text-sm">
                  <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-800">{r.area}</span>
                  <span className="flex-1 text-neutral-800">{r.text}</span>
                  <span className="text-[11px] text-neutral-400">{r.tech} · {r.date}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 3 — Job cost snapshot */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">3 · Job cost snapshot</h2>
          <span className="text-[11px] text-neutral-400">last {jobs.length} invoiced jobs</span>
        </div>
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5">
            <div className="text-[11px] text-neutral-500">avg gross margin</div>
            <div className="text-lg font-bold tabular-nums text-navy-900">{pct(avgMargin)}</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5">
            <div className="text-[11px] text-neutral-500">total outstanding</div>
            <div className="text-lg font-bold tabular-nums text-navy-900">{usd(totalOutstanding)}</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5">
            <div className="text-[11px] text-neutral-500">thin ({`< ${LOW_MARGIN}%`})</div>
            <div className={`text-lg font-bold tabular-nums ${lowMarginCount ? "text-red-700" : "text-navy-900"}`}>{lowMarginCount}</div>
          </div>
        </div>
        {jobs.length === 0 ? (
          <p className="text-xs text-neutral-400">No recent invoiced jobs.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-[11px] uppercase text-neutral-400">
                  <th className="py-1 pr-2 font-medium">Customer</th>
                  <th className="py-1 pr-2 font-medium">Tech</th>
                  <th className="py-1 pr-2 text-right font-medium">Revenue</th>
                  <th className="py-1 pr-2 text-right font-medium">Margin</th>
                  <th className="py-1 pr-2 text-right font-medium">Due</th>
                  <th className="py-1 pr-2 text-right font-medium">Days</th>
                  <th className="py-1 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const thin = j.gross_margin_pct != null && j.gross_margin_pct < LOW_MARGIN;
                  return (
                    <tr key={j.hcp_job_id} className="border-b border-neutral-100 last:border-0">
                      <td className="py-1.5 pr-2">
                        <Link href={`/job/${j.hcp_job_id}`} className="text-brand-700 hover:underline">
                          {j.customer_name ?? j.hcp_job_id.slice(0, 12)}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-2 text-neutral-600">{j.tech_primary_name ?? "—"}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{usd(j.revenue)}</td>
                      <td className={`py-1.5 pr-2 text-right tabular-nums ${thin ? "font-semibold text-red-700" : "text-neutral-700"}`}>{pct(j.gross_margin_pct)}</td>
                      <td className={`py-1.5 pr-2 text-right tabular-nums ${(j.due_amount ?? 0) > 0 ? "text-amber-700" : "text-neutral-400"}`}>{usd(j.due_amount)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-neutral-500">{j.days_outstanding ?? "—"}</td>
                      <td className="py-1.5 text-[11px] text-neutral-400">{j.job_date ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-neutral-400">Amounts are dollars from job_360. Margin thresholds are a triage cue, not accounting.</p>
      </section>

      {/* 4 — Adjustment levers */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">4 · Adjustment levers</h2>

        {/* Field-doctrine approval queue */}
        <div className="mb-4">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Field-doctrine approval queue ({doctrine.length})</h3>
          {doctrine.length === 0 ? (
            <p className="text-xs text-neutral-400">No doctrine cards awaiting approval — all published or retired.</p>
          ) : (
            <ul className="space-y-2">
              {doctrine.map((d) => {
                const risk = d.audience_risk;
                const riskCls = risk === "high" ? "bg-red-100 text-red-800" : risk === "medium" ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-600";
                return (
                  <li key={d.id} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-neutral-900">{d.title}</span>
                      <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">{d.section}</span>
                      {risk ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${riskCls}`}>risk: {risk}</span> : null}
                    </div>
                    <p className="mt-1 text-sm italic text-neutral-700">“{d.rule}”</p>
                    {d.risk_note ? <p className="mt-1 text-[11px] leading-snug text-neutral-500">{d.risk_note}</p> : null}
                    {d.provenance ? <p className="mt-1 text-[11px] leading-snug text-neutral-400">Origin: {d.provenance}</p> : null}
                    <div className="mt-2"><DoctrineReviewControls id={d.id} /></div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* App flags */}
        <div className="mb-4">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">App flags ({flags.length})</h3>
          {flags.length === 0 ? (
            <p className="text-xs text-neutral-400">No app flags set.</p>
          ) : (
            <ul className="space-y-1.5">
              {flags.map((f) => (
                <li key={f.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                  <div className="min-w-0">
                    <span className="font-mono text-sm text-neutral-800">{f.key}</span>
                    {f.updated_by ? <span className="ml-2 text-[11px] text-neutral-400">last by {f.updated_by} · {ago(f.updated_at)}</span> : null}
                  </div>
                  <AppFlagToggle flagKey={f.key} enabled={f.enabled} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Follow-up engine — reuse the owner-gated /dispatch config panel */}
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Estimate follow-up engine</h3>
          <FollowupConfigPanel config={followup} />
        </div>
      </section>
    </main>
  );
}
