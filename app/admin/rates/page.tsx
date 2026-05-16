// /admin/rates — internal rate card visible to admin + manager + leads.
//
// The customer-facing posture stays "upfront pricing" — this page is the
// single source of truth for the numbers Madisson reads off in real time.
// Edit-in-place would come later; for v1 this is read-only + history-aware.
//
// Background: 2026-05-16 Jane Trotzuk situation made it clear Madisson
// shouldn't be improvising rates mid-call. $185 / $215 are the working
// values until Danny formalizes the rate structure further.

import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { Section } from "../../../components/ui/Section";
import { getCurrentTech } from "../../../lib/current-tech";
import { RateEditRow, type RateRow } from "./RateEditRow";

export const metadata = { title: "Internal Rates · Admin · TPAR-DB" };
export const dynamic = "force-dynamic";

type Rate = RateRow;

type HistoryRow = {
  id: number;
  rate_key: string;
  prior_amount_cents: number | null;
  new_amount_cents: number;
  changed_by: string | null;
  changed_at: string;
};

export default async function RatesPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/admin/rates");
  // Leads + admin + manager see rates. Helpers don't (for now).
  const canSee = me.isAdmin || me.isManager || me.tech?.is_lead === true;
  if (!canSee) redirect("/me");
  const canEdit = me.isAdmin;

  const supa = db();
  const [ratesRes, historyRes] = await Promise.all([
    supa.from("internal_rate_card").select("*").order("category").order("amount_cents", { ascending: false }),
    supa.from("internal_rate_card_history").select("*").order("changed_at", { ascending: false }).limit(30),
  ]);

  const rates = (ratesRes.data ?? []) as Rate[];
  const history = (historyRes.data ?? []) as HistoryRow[];

  // Group by category
  const grouped: Record<string, Rate[]> = {};
  for (const r of rates) {
    grouped[r.category] = grouped[r.category] ?? [];
    grouped[r.category].push(r);
  }

  return (
    <PageShell
      kicker="Admin"
      title="Internal Rates"
      description="Source of truth for the numbers Madisson, leads, and admin quote in real time. Customer-facing stays upfront pricing — this is internal."
      backHref="/admin"
      backLabel="Admin"
    >
      <div className="space-y-6">
        {Object.entries(grouped).map(([cat, items]) => (
          <Section key={cat} title={cat.replace(/_/g, " ")}>
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">Rate</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Value</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">When to apply</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">Updated</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {items.map((r) => (
                    <RateEditRow key={r.rate_key} r={r} canEdit={canEdit} />
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        ))}

        {history.length > 0 ? (
          <Section title="Recent rate changes">
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">When</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">Rate</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">Before</th>
                    <th className="px-4 py-2 text-right font-medium text-neutral-600">After</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-600">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {history.map((h) => (
                    <tr key={h.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 font-mono text-xs text-neutral-700">
                        {new Date(h.changed_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-neutral-800">{h.rate_key}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                        {h.prior_amount_cents != null ? `$${(h.prior_amount_cents / 100).toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-800 font-medium">
                        ${(h.new_amount_cents / 100).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-xs text-neutral-600">{h.changed_by ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        ) : null}
      </div>
    </PageShell>
  );
}
