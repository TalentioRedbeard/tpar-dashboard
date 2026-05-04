"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enrollMembership, type MembershipTier } from "../actions";

function fmtMoney(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

export function EnrollForm({
  customerId,
  customerName,
  jobId,
  currentBillDollars,
  tiers,
}: {
  customerId: string;
  customerName: string;
  jobId?: string;
  currentBillDollars: number;
  tiers: MembershipTier[];
}) {
  const router = useRouter();
  const [tierId, setTierId] = useState<string>(tiers[0]?.id ?? "");
  const [cadence, setCadence] = useState<"monthly" | "annual">("annual");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ subscription_id: string; discount_cents: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedTier = tiers.find((t) => t.id === tierId);
  const projectedDiscountDollars = selectedTier && currentBillDollars > 0
    ? (currentBillDollars * Number(selectedTier.bill_discount_pct)) / 100
    : 0;

  if (success) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6">
        <div className="text-lg font-semibold text-emerald-900">Member enrolled.</div>
        <div className="mt-2 text-sm text-emerald-900">
          {customerName} signed up. Bill discount applied at signup: <span className="font-mono">${(success.discount_cents / 100).toLocaleString()}</span>.
        </div>
        <div className="mt-3 rounded-md bg-white/60 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">
          ✓ <strong>Kelsey has been notified</strong> — she&apos;ll add the discount line to the HCP invoice.
          You can confirm to the customer that the discount will appear on their bill.
          <span className="block mt-1 text-emerald-700">Auto-application via HCP API or browser-bot is queued for v1.</span>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => jobId ? router.push(`/job/${jobId}`) : router.push(`/customer/${customerId}`)}
            className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Done →
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!tierId) { setError("Pick a tier."); return; }
        startTransition(async () => {
          const res = await enrollMembership({
            hcp_customer_id: customerId,
            tier_id: tierId,
            signup_job_id: jobId,
            current_bill_dollars: currentBillDollars > 0 ? currentBillDollars : undefined,
            billing_cadence: cadence,
            notes: notes || undefined,
          });
          if (res.ok) {
            setSuccess({ subscription_id: res.subscription_id, discount_cents: res.signup_discount_cents });
          } else {
            setError(res.error);
          }
        });
      }}
    >
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">Tier</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {tiers.map((t) => {
            const selected = t.id === tierId;
            const discountIfSelected = currentBillDollars > 0
              ? (currentBillDollars * Number(t.bill_discount_pct)) / 100
              : 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTierId(t.id)}
                className={
                  "rounded-2xl border p-4 text-left transition " +
                  (selected
                    ? "border-brand-500 bg-brand-50 shadow-md"
                    : "border-neutral-200 bg-white hover:border-neutral-300")
                }
              >
                <div className="flex items-baseline justify-between">
                  <div className="text-base font-semibold text-neutral-900">{t.customer_facing_name}</div>
                  <div className="text-sm font-medium text-brand-700">{t.bill_discount_pct}% off</div>
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  {t.preventative_visits_per_year} preventative visit{t.preventative_visits_per_year === 1 ? "" : "s"}/yr
                </div>
                <p className="mt-2 text-sm text-neutral-700">{t.description}</p>
                {Array.isArray(t.perks) && t.perks.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-neutral-600">
                    {t.perks.slice(0, 4).map((p, i) => (
                      <li key={i}>• {p}</li>
                    ))}
                  </ul>
                ) : null}
                {discountIfSelected > 0 ? (
                  <div className="mt-3 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
                    Saves <span className="font-mono">${Math.round(discountIfSelected).toLocaleString()}</span> on this bill
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">Billing cadence</h2>
        <div className="flex gap-3">
          {(["annual", "monthly"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCadence(c)}
              className={
                "rounded-full px-4 py-2 text-sm font-medium transition " +
                (cadence === c
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200")
              }
            >
              {c === "annual" ? "Annual" : "Monthly"}
            </button>
          ))}
        </div>
      </section>

      {currentBillDollars > 0 && selectedTier ? (
        <section className="rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
          <div className="text-sm font-medium text-brand-900">No-brainer math</div>
          <div className="mt-2 text-sm text-brand-900">
            <div>Current bill: <span className="font-mono">${currentBillDollars.toLocaleString()}</span></div>
            <div>Membership discount ({selectedTier.bill_discount_pct}%): <span className="font-mono">−${Math.round(projectedDiscountDollars).toLocaleString()}</span></div>
            <div className="mt-1 font-semibold">New bill: <span className="font-mono">${Math.round(currentBillDollars - projectedDiscountDollars).toLocaleString()}</span></div>
          </div>
          <div className="mt-2 text-xs text-brand-800">
            The savings on this single bill effectively pays for membership. Tell the customer that.
          </div>
        </section>
      ) : null}

      <section>
        <label className="mb-1 block text-sm font-medium text-neutral-700">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything worth recording — what convinced them, scheduling preferences, etc."
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || !tierId}
          className="rounded-md bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
        >
          {isPending ? "Enrolling…" : "Enroll member"}
        </button>
        {error ? <span className="text-sm text-red-700">{error}</span> : null}
      </div>
    </form>
  );
}
