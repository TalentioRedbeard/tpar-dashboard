// Market reconcile queue (step 3, 2026-06-18). Office confirms/corrects vendor→canonical
// matches → the curated cross-vendor "market". Leadership-gated (admin + manager); the actions
// re-gate. Reached from /shopping (price intel) — the curation surface behind the comparison.

import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { getReconcileQueue } from "@/lib/market-reconcile-actions";
import { MarketReconcileQueue } from "@/components/MarketReconcileQueue";

export const dynamic = "force-dynamic";
export const metadata = { title: "Market reconcile · TPAR-DB" };

export default async function MarketReconcilePage() {
  const me = await getCurrentTech().catch(() => null);
  if (!me) redirect("/login?from=/shopping/reconcile");
  if (!me.isAdmin && !me.isManager) redirect("/me");
  const rows = await getReconcileQueue();
  return (
    <PageShell
      kicker="Market"
      title="Reconcile vendor parts"
      description="Confirm or correct each vendor line's match to your in-house catalog. The matcher proposes by size + material + type; you confirm in one click and identical lines auto-resolve. This is what makes the cross-vendor price comparison trustworthy."
      backHref="/shopping"
      backLabel="Shopping"
    >
      <MarketReconcileQueue initialRows={rows} />
    </PageShell>
  );
}
