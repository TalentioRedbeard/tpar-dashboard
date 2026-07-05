// /context — customer human-context review queue (owner-gated, same gate as
// /conversation). The on-prem worker mines discreet per-customer context from
// comms into customer_context (status='pending_review'); this page is the
// review gate — nothing reaches a customer card until it's kept here. Sibling
// of /conversation's OwnerContextPanel (that one is Danny's OWN context).

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/supabase";
import {
  CustomerContextReviewPanel,
  type CustomerContextGroup,
  type CustomerContextItem,
  type KeptContextItem,
} from "@/components/CustomerContextReviewPanel";

export const dynamic = "force-dynamic";

type PendingRow = CustomerContextItem & { hcp_customer_id: string | null };
type KeptRow = {
  id: string;
  hcp_customer_id: string | null;
  category: string;
  content: string;
  sensitivity: "internal" | "owner_only";
  reviewed_at: string | null;
};

export default async function CustomerContextPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");

  const supa = db();
  const keptCutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();

  const [pendingRes, keptRes, pendingCountRes, keptCountRes, minedCountRes] = await Promise.all([
    supa
      .from("customer_context")
      .select("id, hcp_customer_id, category, content, evidence, sensitivity, created_at")
      .eq("status", "pending_review")
      .order("created_at", { ascending: false })
      .limit(500),
    supa
      .from("customer_context")
      .select("id, hcp_customer_id, category, content, sensitivity, reviewed_at")
      .eq("status", "kept")
      .gte("reviewed_at", keptCutoff)
      .order("reviewed_at", { ascending: false })
      .limit(60),
    supa.from("customer_context").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
    supa.from("customer_context").select("id", { count: "exact", head: true }).eq("status", "kept"),
    supa
      .from("customer_context_runs")
      .select("hcp_customer_id", { count: "exact", head: true })
      .not("processed_at", "is", null),
  ]);

  const pendingRows = (pendingRes.data ?? []) as PendingRow[];
  const keptRows = (keptRes.data ?? []) as KeptRow[];
  const loadError = pendingRes.error?.message ?? null;

  // Resolve display names for every customer on the page in one query.
  const customerIds = [
    ...new Set(
      [...pendingRows, ...keptRows].map((r) => r.hcp_customer_id).filter((id): id is string => !!id),
    ),
  ];
  const nameById = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: customers } = await supa
      .from("customers_master")
      .select("hcp_customer_id, name, first_name, last_name")
      .in("hcp_customer_id", customerIds);
    for (const c of (customers ?? []) as Array<{
      hcp_customer_id: string;
      name: string | null;
      first_name: string | null;
      last_name: string | null;
    }>) {
      const display =
        c.name?.trim() || [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
      if (display) nameById.set(c.hcp_customer_id, display);
    }
  }

  // Group pending items by customer. Rows arrive created_at desc, so first
  // appearance = newest-mined customer → groups already ordered newest-first.
  const groupById = new Map<string, CustomerContextGroup>();
  for (const row of pendingRows) {
    const id = row.hcp_customer_id ?? "unknown";
    let group = groupById.get(id);
    if (!group) {
      group = { hcpCustomerId: id, displayName: nameById.get(id) ?? id, items: [] };
      groupById.set(id, group);
    }
    group.items.push({
      id: row.id,
      category: row.category,
      content: row.content,
      evidence: row.evidence,
      sensitivity: row.sensitivity,
      created_at: row.created_at,
    });
  }
  const groups = [...groupById.values()];

  const kept: KeptContextItem[] = keptRows.map((r) => ({
    id: r.id,
    category: r.category,
    content: r.content,
    sensitivity: r.sensitivity,
    reviewed_at: r.reviewed_at,
    customerName: (r.hcp_customer_id && nameById.get(r.hcp_customer_id)) || r.hcp_customer_id || "unknown",
  }));

  const pendingCount = pendingCountRes.count ?? 0;
  const keptCount = keptCountRes.count ?? 0;
  const minedCount = minedCountRes.count ?? 0;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold text-navy-900">Customer context — review queue</h1>
        <p className="mt-1 text-sm text-navy-900/60">
          {pendingCount} pending · {keptCount} kept · {minedCount} customer{minedCount === 1 ? "" : "s"} mined
        </p>
      </header>
      <CustomerContextReviewPanel groups={groups} kept={kept} loadError={loadError} />
    </main>
  );
}
