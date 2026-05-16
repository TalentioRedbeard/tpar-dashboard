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
import { Pill } from "../../../components/ui/Pill";
import { getCurrentTech } from "../../../lib/current-tech";

export const metadata = { title: "Internal Rates · Admin · TPAR-DB" };
export const dynamic = "force-dynamic";

type Rate = {
  rate_key: string;
  category: string;
  display_name: string;
  unit: "flat" | "hour" | "percent" | "each";
  amount_cents: number;
  is_active: boolean;
  scope_notes: string | null;
  effective_since: string;
  updated_by: string | null;
  updated_at: string;
};

type HistoryRow = {
  id: number;
  rate_key: string;
  prior_amount_cents: number | null;
  new_amount_cents: number;
  changed_by: string | null;
  changed_at: string;
};

function fmtValue(unit: Rate["unit"], cents: number): string {
  if (unit === "percent") return `${cents}%`;
  const dollars = cents / 100;
  if (unit === "flat") return `$${dollars.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  if (unit === "hour") return `$${dollars.toFixed(0)}/hr`;
  if (unit === "each") return `$${dollars.toFixed(2)} ea`;
  return `${cents}¢`;
}

function categoryTone(cat: string): "green" | "amber" | "violet" | "brand" | "slate" {
  switch (cat) {
    case "service":     return "brand";
    case "labor":       return "violet";
    case "travel":      return "slate";
    case "after_hours": return "amber";
    case "discount":    return "green";
    case "membership":  return "violet";
    default:            return "slate";
  }
}

export default async function RatesPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/admin/rates");
  // Leads + admin + manager see rates. Helpers don't (for now).
  const canSee = me.isAdmin || me.isManager || me.tech?.is_lead === true;
  if (!canSee) redirect("/me");

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
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {items.map((r) => (
                    <tr key={r.rate_key} className={r.is_active ? "hover:bg-neutral-50" : "bg-neutral-50/50 text-neutral-400"}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-neutral-900">{r.display_name}</span>
                          <Pill tone={categoryTone(r.category)}>{r.category}</Pill>
                          {!r.is_active ? <Pill tone="slate">inactive</Pill> : null}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-neutral-400">{r.rate_key}</div>
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-base font-semibold text-neutral-900">
                        {fmtValue(r.unit, r.amount_cents)}
                      </td>
                      <td className="px-4 py-2 text-xs leading-relaxed text-neutral-700 max-w-md">{r.scope_notes ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-neutral-500">
                        {new Date(r.updated_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short" })}
                        {r.updated_by ? <div className="text-[10px] text-neutral-400">by {r.updated_by}</div> : null}
                      </td>
                    </tr>
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
