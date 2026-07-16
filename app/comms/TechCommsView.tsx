// /comms tech-scoped view — calls & texts for the CUSTOMERS whose work this
// tech was on ("what pertains to me"). This is distinct from /me's "My recent
// comms" (comms ATTRIBUTED to the tech): this is the conversation history for
// the tech's customers, so they walk in already knowing the story.
//
// Scope (A7 rebase, 2026-07-16): the canonical rule via
// lib/tech-scope.techScopedCustomerIds — hcp_employee_id against
// jobs_master.assigned_employees ∪ appointments_master.tech_all_ids, FULL
// history, fail closed. (The old view name-matched appointments in a ±90d
// window — the same class of lockout the customers page had.) The default
// feed still shows the recent 90 days; a SEARCH lifts the window so any
// conversation on their own customers is findable. Scope is a security
// boundary here (db() is service-role) — never suspended, even in search;
// the admin inbox's search-suspends-tech-filter convenience must NOT be
// copied down.
//
// LANDMINES: communication_events is calls+texts (channel 'text', not 'sms');
// importance=0 = system-notification noise (~29%, hidden, same as the
// leadership inbox); internal-direction comms are leadership-internal and
// excluded; comm.hcp_job_id is best-effort/often null, so "search by the job"
// routes through jobs_master text → customer ids, never eq on that column.

import Link from "next/link";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { FilterBar } from "../../components/Table";
import { techScopedCustomerIds } from "../../lib/tech-scope";
import { assignedHasEmployee } from "../../lib/assigned-employees";

const CHI = "America/Chicago";

type Comm = {
  id: number;
  occurred_at: string;
  channel: string | null;
  direction: string | null;
  hcp_customer_id: string | null;
  customer_name: string | null;
  importance: number | null;
  sentiment: string | null;
  summary: string | null;
};

function fmtChi(s: string): string {
  return new Date(s).toLocaleString("en-US", { timeZone: CHI, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function channelTone(ch: string | null): { cls: string; label: string } {
  if (ch === "call") return { cls: "bg-brand-100 text-brand-800", label: "call" };
  if (ch === "text") return { cls: "bg-emerald-100 text-emerald-800", label: "text" };
  if (ch === "email") return { cls: "bg-slate-100 text-slate-700", label: "email" };
  return { cls: "bg-neutral-100 text-neutral-600", label: ch ?? "—" };
}
function sentimentTone(s: string | null): string {
  if (s === "positive") return "bg-emerald-100 text-emerald-800";
  if (s === "negative") return "bg-red-100 text-red-800";
  if (s === "neutral") return "bg-neutral-100 text-neutral-700";
  return "bg-neutral-50 text-neutral-500";
}
// Strip the characters that break PostgREST's .or() parser (same rule as
// customers/search-actions.ts clean()).
function sanitize(s: string): string {
  return s.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
}

const COMM_COLS = "id, occurred_at, channel, direction, hcp_customer_id, customer_name, importance, sentiment, summary";
const LIST_CAP = 60;

export async function TechCommsView({
  hcpEmployeeId,
  shortName,
  q,
  channel,
}: {
  hcpEmployeeId: string | null;
  shortName: string;
  q: string;
  channel: string;
}) {
  const supa = db();
  const searching = q.trim().length >= 2;
  const qSafe = sanitize(q);

  // 1. Every customer whose work this tech was on (full history, fail closed).
  const custIds = await techScopedCustomerIds(hcpEmployeeId);
  const customerIds = [...custIds];

  // 2. Their comms. Default feed = last 90 days; search lifts the window.
  const commsSince = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const collected = new Map<number, Comm>();
  if (customerIds.length) {
    for (let i = 0; i < customerIds.length && collected.size < 400; i += 100) {
      let query = supa
        .from("communication_events")
        .select(COMM_COLS)
        .in("hcp_customer_id", customerIds.slice(i, i + 100))
        .gt("importance", 0)
        .or("direction.is.null,direction.neq.internal")
        .order("occurred_at", { ascending: false })
        .limit(LIST_CAP);
      if (searching && qSafe) query = query.or(`customer_name.ilike.%${qSafe}%,summary.ilike.%${qSafe}%`);
      else query = query.gte("occurred_at", commsSince);
      if (channel) query = query.eq("channel", channel);
      const { data } = await query;
      for (const c of (data ?? []) as Comm[]) collected.set(c.id, c);
    }
  }

  // 3. "Search by the job": text-match the tech's OWN jobs (address /
  //    description / notes) → those customers' comms, unioned in. Mirrors the
  //    customers-page deep interpreter, scoped the same way.
  if (searching && qSafe.length >= 3 && customerIds.length) {
    const orExpr = ["address", "job_description", "hcp_notes"]
      .map((col) => `${col}.ilike.%${qSafe}%`)
      .join(",");
    const { data: jobHits } = await supa
      .from("jobs_master")
      .select("hcp_customer_id, assigned_employees")
      .like("assigned_employees", `%${hcpEmployeeId}%`)
      .not("hcp_customer_id", "is", null)
      .or(orExpr)
      .limit(50);
    const jobCustIds = [...new Set(
      ((jobHits ?? []) as Array<{ hcp_customer_id: string | null; assigned_employees: string | null }>)
        .filter((j) => assignedHasEmployee(j.assigned_employees, hcpEmployeeId ?? ""))
        .map((j) => j.hcp_customer_id as string)
        .filter((id) => custIds.has(id)),
    )];
    if (jobCustIds.length) {
      let query = supa
        .from("communication_events")
        .select(COMM_COLS)
        .in("hcp_customer_id", jobCustIds.slice(0, 100))
        .gt("importance", 0)
        .or("direction.is.null,direction.neq.internal")
        .order("occurred_at", { ascending: false })
        .limit(LIST_CAP);
      if (channel) query = query.eq("channel", channel);
      const { data } = await query;
      for (const c of (data ?? []) as Comm[]) collected.set(c.id, c);
    }
  }

  const comms = [...collected.values()]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, LIST_CAP);

  return (
    <PageShell
      title="Comms"
      description={`Calls & texts for your customers — full work history · ${shortName}`}
      help={{
        intent: "The call/text story for YOUR customers — so you walk in already knowing the conversation.",
        actions: [
          "Fresh feed shows the last 90 days; searching digs through your whole history.",
          "Search by the customer's name, what was said, or the job (address / what the work was).",
          "Tap a customer to open their record; 'transcript →' opens the call itself.",
          "For calls/texts attributed to YOU, see My day → My recent comms.",
        ],
        stuck: "Can't find a conversation? It may be with a customer whose work you weren't on — those are outside your view. Ask Danny if you think that's wrong.",
      }}
    >
      {!hcpEmployeeId ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your HCP profile isn&apos;t linked yet, so we can&apos;t find your customers. Ask Danny to link your HCP employee id in the tech directory.
        </div>
      ) : (
        <>
          <FilterBar>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={'customer, what was said, or the job — "crow" / "water heater"'}
              className="w-full max-w-md rounded-xl border border-neutral-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <select name="channel" defaultValue={channel} className="rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm">
              <option value="">all channels</option>
              <option value="call">calls</option>
              <option value="text">texts</option>
              <option value="email">email</option>
            </select>
            <button type="submit" className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
              Search
            </button>
            {searching ? (
              <Link href="/comms" className="text-xs text-neutral-500 hover:underline">clear</Link>
            ) : null}
          </FilterBar>

          {customerIds.length === 0 ? (
            <div className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
              No customers on your work history yet — they&apos;ll show here once you&apos;re on jobs. <Link href="/schedule" className="underline">My schedule →</Link>
            </div>
          ) : comms.length === 0 ? (
            <div className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
              {searching
                ? <>Nothing matches &ldquo;{q}&rdquo; across your {customerIds.length} customers. Try the customer&apos;s name, the address, or what the job was.</>
                : <>No calls or texts in the last 90 days for your {customerIds.length} customer{customerIds.length === 1 ? "" : "s"} — search to dig further back.</>}
            </div>
          ) : (
            <>
              <div className="mb-3 text-xs text-neutral-500">
                {comms.length}{comms.length === LIST_CAP ? "+" : ""} comm{comms.length === 1 ? "" : "s"}
                {searching ? ` matching across your ${customerIds.length} customers (full history)` : ` across your customers (${customerIds.length}) — last 90 days`}
              </div>
              <ul className="space-y-2">
                {comms.map((c) => {
                  const ch = channelTone(c.channel);
                  return (
                    <li key={c.id} className="rounded-2xl border border-neutral-200 bg-white p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                        <span className="text-neutral-600">
                          {fmtChi(c.occurred_at)}
                          {c.direction ? <span className="ml-1 uppercase text-neutral-400">{c.direction}</span> : null}
                        </span>
                        <span className="flex flex-wrap items-baseline gap-1">
                          <span className={`rounded-md px-1.5 py-0.5 font-medium ${ch.cls}`}>{ch.label}</span>
                          {c.importance != null && c.importance >= 7 ? (
                            <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">imp {c.importance}</span>
                          ) : null}
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
                        <Link href={`/comms/${c.id}`} className="shrink-0 text-xs text-brand-700 hover:underline">transcript →</Link>
                      </div>
                      <div className="mt-1 text-sm text-neutral-700">{c.summary?.slice(0, 260) ?? "—"}</div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-4 text-xs text-neutral-500">
                Your customers only. System-notification noise (importance 0) and internal-only notes are hidden.
              </p>
            </>
          )}
        </>
      )}
    </PageShell>
  );
}
