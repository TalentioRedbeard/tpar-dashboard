// /shopping/rfq — parts bid / RFQ flow (2026-06-18). Build a bid request from open needs + parts,
// set urgency, pick suppliers, one-tap a prefilled order email per supplier (mailto), then log
// their bids to compare on price + delivery and award. Leadership-only (purchasing); actions re-gate.

import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { RfqConsole } from "@/components/RfqConsole";
import { getOpenNeeds } from "../actions";
import { listSupplierTargets, listRfqs } from "../rfq-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Parts bids · TPAR-DB" };

export default async function RfqPage() {
  const me = await getCurrentTech().catch(() => null);
  if (!me) redirect("/login?from=/shopping/rfq");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  const [needs, suppliers, rfqs] = await Promise.all([
    getOpenNeeds({ limit: 100 }),
    listSupplierTargets(),
    listRfqs(),
  ]);
  const openNeeds = needs.map((n) => ({
    id: n.id,
    item: n.item_description,
    qty: n.qty == null || n.qty === "" ? null : Number(n.qty) || null,
    urgency: String(n.urgency),
  }));
  const fromName = me.tech?.hcp_full_name ?? me.tech?.tech_short_name ?? me.email.replace("@tulsapar.com", "");

  return (
    <PageShell
      kicker="Market"
      title="Parts bids"
      description="Make suppliers compete for your order. Build a request, send it to the suppliers you choose with an urgency label, and award the best price + delivery."
      backHref="/shopping"
      backLabel="Shopping"
      hideAskBar
      help={{
        intent:
          "Run a competitive bid on parts: pick the parts (from open needs or type them), set urgency, choose which suppliers to ask, and fire a prefilled order email to each (opens your mail app). Log their replies — price, delivery, lead time — to compare and award the best one.",
        actions: [
          "New bid request → pick parts + urgency + suppliers → Create",
          "Tap each supplier's ✉ button to send the prefilled order/bid request",
          "Log each reply (price + delivery), then 'award' the winner",
        ],
        stuck:
          "Suppliers without an order email are greyed out — add one on the distributor record. Sending the email is mailto (your mail app) for now; auto-send + a live status link is a planned upgrade.",
      }}
    >
      <RfqConsole openNeeds={openNeeds} suppliers={suppliers} initialRfqs={rfqs} fromName={fromName} />
    </PageShell>
  );
}
