// /shopping/market — the part price reverse-lookup (market step 5, 2026-06-18). Type a part
// in plain language → what each supplier has charged (real receipts via the inv→canonical
// link + confirmed curated quotes), cheapest first, with supplier contact. Leadership-only
// (pricing/cost), same gate as the price-intel panel; the action re-gates.

import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { MarketLookup } from "@/components/MarketLookup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Part price lookup · TPAR-DB" };

export default async function MarketPage() {
  const me = await getCurrentTech().catch(() => null);
  if (!me) redirect("/login?from=/shopping/market");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  return (
    <PageShell
      kicker="Market"
      title="Part price lookup"
      description="Type a part the way you'd say it → what each supplier has actually charged (from real receipts), cheapest first, with who to order from."
      backHref="/shopping"
      backLabel="Shopping"
      hideAskBar
      help={{
        intent:
          "The reverse-lookup: type a part in plain plumber language (size + material + kind) and get what each supplier has charged for it, cheapest first, plus the number/email to order from. Prices come from your real receipt history, normalized per piece or per foot.",
        actions: [
          "Search a part, e.g. “3/4 brass tee” or “1-1/2 pvc 90 elbow”",
          "Compare the per-vendor prices (the cheapest is flagged, with the supplier's contact)",
          "Check each vendor's own description to confirm it's the same part before trusting a gap",
        ],
        stuck:
          "No match? Use size + material + part kind. Items with no price history yet are listed under the collapsible — they're in the catalog but haven't been bought on a logged receipt.",
      }}
    >
      <MarketLookup />
    </PageShell>
  );
}
