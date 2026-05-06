// /admin/leads — surfaced new-lead queue. Reads communication_events flagged
// `new_lead` (classifier upgrade 2026-05-05). Per-row contact extraction +
// "mark handled" via the existing acked_at column.

import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { listOpenLeads, listHandledLeads, type Lead } from "./actions";
import { MarkHandledForm, ReopenForm } from "./MarkHandledForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads · TPAR-DB" };

function fmtAbs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function fmtPhone(d: string): string {
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function importanceTone(n: number): string {
  if (n >= 9) return "bg-red-50 text-red-800 ring-red-200";
  if (n >= 7) return "bg-orange-50 text-orange-800 ring-orange-200";
  if (n >= 5) return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-neutral-50 text-neutral-700 ring-neutral-200";
}

function LeadCard({ lead, isHandled }: { lead: Lead; isHandled: boolean }) {
  const tone = importanceTone(lead.importance);
  const age = ageDays(lead.occurred_at);
  return (
    <li className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      {/* Header strip */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 font-medium ring-1 ring-inset ${tone}`}>
            ★ {lead.importance}
          </span>
          {lead.is_paid ? (
            <span className="rounded bg-violet-50 px-2 py-0.5 font-medium text-violet-800 ring-1 ring-inset ring-violet-200">
              PAID
            </span>
          ) : null}
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-neutral-600">
            {lead.channel}
          </span>
          <span className="text-neutral-500">{fmtAbs(lead.occurred_at)}</span>
          <span className={age > 7 ? "font-medium text-red-700" : "text-neutral-400"}>
            {age}d cold
          </span>
          <span className="font-mono text-[10px] text-neutral-400">#{lead.id}</span>
        </div>
        {isHandled ? (
          <div className="flex items-center gap-2 text-emerald-700">
            <span>handled {fmtAbs(lead.acked_at)} by {lead.acked_by ?? "?"}</span>
            <ReopenForm id={lead.id} />
          </div>
        ) : null}
      </div>

      {/* Customer + summary */}
      <div className="px-4 py-3">
        <div className="text-sm font-semibold text-neutral-900">
          {lead.customer_name ?? "Unknown sender"}
        </div>
        {lead.summary ? (
          <div className="mt-1 text-sm text-neutral-700">{lead.summary}</div>
        ) : null}
      </div>

      {/* Contacts */}
      {(lead.extracted_phones.length > 0 || lead.extracted_emails.length > 0) ? (
        <div className="border-t border-neutral-100 bg-neutral-50/50 px-4 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {lead.extracted_phones.map((p) => (
              <a
                key={p}
                href={`tel:+1${p}`}
                className="rounded-md bg-white px-2 py-1 font-mono ring-1 ring-neutral-200 hover:bg-brand-50 hover:ring-brand-300"
              >
                📞 {fmtPhone(p)}
              </a>
            ))}
            {lead.extracted_emails.map((e) => (
              <a
                key={e}
                href={`mailto:${e}`}
                className="rounded-md bg-white px-2 py-1 ring-1 ring-neutral-200 hover:bg-brand-50 hover:ring-brand-300"
              >
                ✉ {e}
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {/* Mark handled */}
      {!isHandled ? (
        <div className="border-t border-neutral-100 bg-neutral-50/50 px-4 py-2">
          <div className="flex items-center justify-end">
            <MarkHandledForm id={lead.id} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default async function LeadsPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/admin/leads");
  if (!me.isAdmin && !me.isManager) {
    return (
      <PageShell title="Leadership only">
        <EmptyState title="Not authorized." />
      </PageShell>
    );
  }

  const [open, handled] = await Promise.all([
    listOpenLeads(),
    listHandledLeads(15),
  ]);

  const paidCount = open.filter((l) => l.is_paid).length;

  return (
    <PageShell
      kicker="Admin · Leads"
      title="New leads to work"
      description={`Inbound prospects flagged by the classifier (calls + texts). ${paidCount > 0 ? `${paidCount} are paid-acquisition.` : ""} Mark handled when contacted or won/lost.`}
    >
      <Section title={`${open.length} open`} description="Sorted by importance, then recency. Older leads cool fast.">
        {open.length === 0 ? (
          <EmptyState
            title="No open leads."
            description="Inbound prospect-shaped messages from texts and calls will appear here as the classifier flags them."
          />
        ) : (
          <ul className="space-y-3">
            {open.map((lead) => (
              <LeadCard key={lead.id} lead={lead} isHandled={false} />
            ))}
          </ul>
        )}
      </Section>

      <div className="my-6" />

      <Section title="Recently handled" description="Last 15 — for audit and reopens.">
        {handled.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing handled yet.</p>
        ) : (
          <ul className="space-y-3">
            {handled.map((lead) => (
              <LeadCard key={lead.id} lead={lead} isHandled={true} />
            ))}
          </ul>
        )}
      </Section>
    </PageShell>
  );
}
