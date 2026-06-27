// Campaign-draft review — vet AI-personalized campaign messages before they
// send. Generic over campaign_key (default = the live water-filtration push);
// future campaigns reuse this page by switching the campaign chip.
//
// GATE: office / manager / owner (admin, manager, lead, or signed-in office).
// Pure field techs go to /me — same office-facing posture as /dispatch. The
// page gate only decides whether to RENDER; the per-draft write actions in
// lib/campaign-review-actions.ts self-authorize via requireResolver().
//
// DATA ACCESS: campaign_message_drafts has RLS enabled with NO policies, so the
// authenticated role can read nothing. The read below uses the SERVICE-ROLE
// db() client — identical to the /dispatch data path.

import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { getCurrentTech, roleFor } from "../../../lib/current-tech";
import {
  CampaignReviewPanel,
  type CampaignOption,
} from "../../../components/CampaignReviewPanel";
import type { CampaignDraft } from "../../../lib/campaign-review-actions";

export const metadata = { title: "Campaign review · TPAR-DB" };
export const dynamic = "force-dynamic";

const DEFAULT_CAMPAIGN = "water-filtration-2026-07";

const DRAFT_COLS =
  "id, campaign_key, normalized_email, customer_name, hcp_customer_id, entity_id, assigned_tech, segment_type, signal, draft_subject, draft_body, basis, review_status, reviewed_by, reviewed_at, final_subject, final_body, created_at";

export default async function CampaignReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  // ── Gate: office-facing (admin / manager / lead / office). Field techs out. ──
  const me = await getCurrentTech().catch(() => null);
  if (!me) redirect("/login?from=/campaigns/review");
  const role = roleFor(me);
  const allowed = me.isAdmin || me.isManager || !!me.tech?.is_lead || role === "office";
  if (!allowed) redirect("/me");

  const supa = db(); // service-role — RLS has no policies, so this is the only way to read.

  // Distinct campaign keys present, with counts, for the chooser chips.
  const { data: keyRows } = await supa
    .from("campaign_message_drafts")
    .select("campaign_key")
    .limit(20000);
  const counts = new Map<string, number>();
  for (const r of (keyRows ?? []) as { campaign_key: string | null }[]) {
    const k = r.campaign_key ?? "";
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const campaigns: CampaignOption[] = [...counts.entries()]
    .map(([campaign_key, total]) => ({ campaign_key, total }))
    .sort((a, b) => b.total - a.total);

  // Selected campaign — default to the flagship; fall back to whatever exists.
  const sp = await searchParams;
  const requested = sp.campaign?.trim();
  const campaignKey =
    (requested && counts.has(requested) ? requested : null) ??
    (counts.has(DEFAULT_CAMPAIGN) ? DEFAULT_CAMPAIGN : campaigns[0]?.campaign_key) ??
    DEFAULT_CAMPAIGN;

  const { data } = await supa
    .from("campaign_message_drafts")
    .select(DRAFT_COLS)
    .eq("campaign_key", campaignKey)
    .order("assigned_tech", { ascending: true, nullsFirst: false })
    .order("customer_name", { ascending: true, nullsFirst: false })
    .limit(5000);
  const drafts = (data ?? []) as CampaignDraft[];

  return (
    <PageShell
      icon="📣"
      title="Campaign review"
      description="Vet AI-personalized campaign messages before they send. Grouped by the tech who worked the job (the reviewer); Unassigned is the office pile. HOLD rows are internal notes, not sendable."
    >
      {campaigns.length === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          No campaign drafts found yet.
        </p>
      ) : (
        <CampaignReviewPanel campaignKey={campaignKey} campaigns={campaigns} drafts={drafts} />
      )}
    </PageShell>
  );
}
