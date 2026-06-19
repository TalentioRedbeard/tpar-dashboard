// /shopping/catalog — the interactive parts catalog (2026-06-18). Browse the in-house canonical
// catalog with blended real prices (receipts + confirmed quotes) per vendor, plus ordering +
// delivery info. Leadership-only (pricing); the actions re-gate. Search-style lookup lives at
// /shopping/market; this is the browse-by-category surface.

import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { CatalogBrowser } from "@/components/CatalogBrowser";
import { loadCatalog, getCatalogFacets } from "../catalog-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Parts catalog · TPAR-DB" };

export default async function CatalogPage() {
  const me = await getCurrentTech().catch(() => null);
  if (!me) redirect("/login?from=/shopping/catalog");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  const [items, facets] = await Promise.all([
    loadCatalog({ pricedOnly: true }), // default view = parts we can price right now
    getCatalogFacets(),
  ]);

  return (
    <PageShell
      kicker="Market"
      title="Parts catalog"
      description="Browse the in-house catalog by category or material. Each part shows what every supplier has charged (real receipts + confirmed quotes), cheapest first, with how to order and what we know about delivery."
      backHref="/shopping"
      backLabel="Shopping"
      hideAskBar
      help={{
        intent:
          "The interactive catalog: filter parts by category/material/text, expand any part to compare every supplier's real price (receipts + confirmed quotes), see how to order, and the delivery terms we've captured. For a quick single-part search instead, use the part lookup.",
        actions: [
          "Filter by category, material, or search; toggle 'priced only' off to see the whole catalog",
          "Expand a part to compare vendors — cheapest is flagged, with the order email/phone",
          "Delivery shows per supplier; 'not set' means we haven't captured that supplier's terms yet",
        ],
        stuck:
          "A part shows 'no price yet' when no receipt or confirmed quote is linked. Delivery is blank until a supplier's terms are filled in on the distributor record.",
      }}
    >
      <CatalogBrowser initialItems={items} facets={facets} />
    </PageShell>
  );
}
