// /comms tech-scoped view — calls & texts for the CUSTOMERS this tech is
// scheduled to work with, within ~3 months ("what pertains to me"). This is
// distinct from /me's "My recent comms" (comms ATTRIBUTED to the tech): this is
// the conversation history for the tech's customers, so they walk in already
// knowing the story.
//
// Scope: the tech's appointments (last ~90d + upcoming ~30d) -> set of
// hcp_customer_id -> communication_events for those customers in the last ~90d.
// LANDMINES: appointments_master tech cols are FULL names (tech_primary_name /
// tech_all_names); communication_events is calls+texts (channel 'text', not
// 'sms'); importance=0 = system-notification noise (~29%, hidden by default,
// same as the leadership inbox); internal-direction comms are leadership-internal
// and excluded.

import Link from "next/link";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";

const CHI = "America/Chicago";

type ApptLite = {
  hcp_customer_id: string | null;
  customer_name: string | null;
  tech_primary_name: string | null;
  tech_all_names: string[] | null;
};
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

export async function TechCommsView({ fullName, shortName }: { fullName: string | null; shortName: string }) {
  const supa = db();
  const apptSince = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const apptUntil = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const commsSince = new Date(Date.now() - 90 * 86_400_000).toISOString();

  // 1. The customers this tech is scheduled with (own appointments, ~3mo window).
  const custName = new Map<string, string>();
  if (fullName) {
    const { data: appts } = await supa
      .from("appointments_master")
      .select("hcp_customer_id, customer_name, tech_primary_name, tech_all_names")
      .is("deleted_at", null)
      .gte("scheduled_start", apptSince)
      .lt("scheduled_start", apptUntil);
    for (const a of (appts ?? []) as ApptLite[]) {
      const mine = a.tech_primary_name === fullName || (a.tech_all_names ?? []).includes(fullName);
      if (!mine || !a.hcp_customer_id) continue;
      if (!custName.has(a.hcp_customer_id)) custName.set(a.hcp_customer_id, a.customer_name ?? "—");
    }
  }
  const customerIds = [...custName.keys()];

  // 2. Calls/texts for those customers in the last ~3 months (noise + internal hidden).
  let comms: Comm[] = [];
  if (customerIds.length) {
    const { data } = await supa
      .from("communication_events")
      .select("id, occurred_at, channel, direction, hcp_customer_id, customer_name, importance, sentiment, summary")
      .in("hcp_customer_id", customerIds)
      .gte("occurred_at", commsSince)
      .gt("importance", 0)
      .or("direction.is.null,direction.neq.internal")
      .order("occurred_at", { ascending: false })
      .limit(60);
    comms = (data ?? []) as Comm[];
  }

  return (
    <PageShell
      title="Comms"
      description={`Calls & texts for the customers you're scheduled with — last 3 months · ${shortName}`}
      help={{
        intent: "The recent call/text history for the customers on your schedule — so you walk in already knowing the conversation. Only your customers; system-notification noise hidden.",
        actions: [
          "Scoped to customers from your appointments (last 3 months + upcoming).",
          "Tap a customer to open their full record; tap 'transcript →' for the call.",
          "For calls/texts attributed to YOU, see My day → My recent comms.",
        ],
      }}
    >
      {!fullName ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your HCP name isn&apos;t linked yet, so we can&apos;t find your customers. Ask Danny to set your HCP name in the tech directory.
        </div>
      ) : customerIds.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
          No customers on your schedule in the last 3 months yet — they&apos;ll show here once you have appointments. <Link href="/schedule" className="underline">My schedule →</Link>
        </div>
      ) : comms.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
          No calls or texts in the last 3 months for your {customerIds.length} scheduled customer{customerIds.length === 1 ? "" : "s"}.
        </div>
      ) : (
        <>
          <div className="mb-3 text-xs text-neutral-500">
            {comms.length} comm{comms.length === 1 ? "" : "s"} across your scheduled customers ({customerIds.length})
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
                        {c.customer_name ?? custName.get(c.hcp_customer_id) ?? "—"}
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
            Your scheduled customers only. System-notification noise (importance 0) and internal-only notes are hidden.
          </p>
        </>
      )}
    </PageShell>
  );
}
