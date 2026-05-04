"use server";

// Membership program v0 server actions.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type MembershipTier = {
  id: string;
  name: string;
  customer_facing_name: string;
  description: string;
  perks: string[];
  preventative_visits_per_year: number;
  bill_discount_pct: number;
  monthly_price_cents: number | null;
  annual_price_cents: number | null;
  sort_order: number;
};

export type MembershipStatus = {
  subscription_id: string;
  tier_name: string;
  customer_facing_name: string;
  bill_discount_pct: number;
  status: string;
  started_at: string;
  current_period_end: string | null;
  enrolled_by_tech: string | null;
  signup_job_id: string | null;
  signup_discount_cents: number | null;
};

export async function getActiveTiers(): Promise<MembershipTier[]> {
  const supabase = db();
  const { data } = await supabase
    .from("membership_tiers")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  return (data ?? []) as MembershipTier[];
}

export async function getCurrentMembership(hcp_customer_id: string): Promise<MembershipStatus | null> {
  const supabase = db();
  const { data } = await supabase
    .from("customer_membership_status_v")
    .select("*")
    .eq("hcp_customer_id", hcp_customer_id)
    .eq("recency_rank", 1)
    .maybeSingle();
  return (data as MembershipStatus | null) ?? null;
}

export type EnrollResult =
  | { ok: true; subscription_id: string; signup_discount_cents: number }
  | { ok: false; error: string };

export async function enrollMembership(input: {
  hcp_customer_id: string;
  tier_id: string;
  signup_job_id?: string;
  current_bill_dollars?: number;
  billing_cadence?: "monthly" | "annual";
  notes?: string;
}): Promise<EnrollResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite) return { ok: false, error: "You don't have write access." };

  const supabase = db();

  // Look up the tier to compute discount
  const { data: tier, error: tierErr } = await supabase
    .from("membership_tiers")
    .select("bill_discount_pct, customer_facing_name, active")
    .eq("id", input.tier_id)
    .maybeSingle();
  if (tierErr || !tier || !tier.active) {
    return { ok: false, error: "Tier not found or inactive." };
  }

  // Compute signup_discount_cents (applied to the bill at sign-up)
  const billCents = input.current_bill_dollars != null ? Math.round(input.current_bill_dollars * 100) : 0;
  const discountCents = Math.round(billCents * Number(tier.bill_discount_pct) / 100);

  // Check for an existing active subscription — don't double-enroll
  const { data: existing } = await supabase
    .from("membership_subscriptions")
    .select("id")
    .eq("hcp_customer_id", input.hcp_customer_id)
    .eq("status", "active")
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: false, error: "Customer already has an active membership. Cancel it first if changing tiers." };
  }

  const cadence = input.billing_cadence ?? "annual";
  const now = new Date();
  const periodEnd = new Date(now);
  if (cadence === "monthly") periodEnd.setMonth(periodEnd.getMonth() + 1);
  else periodEnd.setFullYear(periodEnd.getFullYear() + 1);

  const { data: inserted, error: insErr } = await supabase
    .from("membership_subscriptions")
    .insert({
      hcp_customer_id:      input.hcp_customer_id,
      tier_id:              input.tier_id,
      status:               "active",
      enrolled_by_tech:     me.tech?.tech_short_name ?? me.email,
      signup_job_id:        input.signup_job_id ?? null,
      signup_discount_cents: discountCents,
      billing_cadence:       cadence,
      current_period_end:    periodEnd.toISOString(),
      notes:                 input.notes ?? null,
    })
    .select("id")
    .single();

  if (insErr || !inserted) return { ok: false, error: insErr?.message ?? "insert failed" };

  revalidatePath(`/customer/${input.hcp_customer_id}`);
  if (input.signup_job_id) revalidatePath(`/job/${input.signup_job_id}`);

  // Fire Kelsey notification (#129 v0.2 — HCP discount-application path).
  // Recorded discount needs to be APPLIED to the actual HCP invoice;
  // direct API or browser-bot integration is queued. For now Kelsey gets
  // a Slack DM with full context so she can apply manually.
  // Fire-and-forget — never block enrollment on notification failure.
  notifyKelseyOfMembershipSignup({
    hcp_customer_id: input.hcp_customer_id,
    signup_job_id: input.signup_job_id ?? null,
    tier_label: tier.customer_facing_name as string,
    bill_discount_pct: Number(tier.bill_discount_pct),
    discount_cents: discountCents,
    bill_dollars: input.current_bill_dollars ?? null,
    enrolled_by_tech: me.tech?.tech_short_name ?? me.email,
    cadence,
  }).catch(() => {});

  return { ok: true, subscription_id: inserted.id as string, signup_discount_cents: discountCents };
}

/**
 * Fire-and-forget Slack DM to Kelsey via the notify-danny edge fn (which now
 * accepts a recipient_slack_user_id override + service-role bearer auth).
 * Looks up Kelsey's slack_user_id from tech_directory; falls back to Danny.
 */
async function notifyKelseyOfMembershipSignup(input: {
  hcp_customer_id: string;
  signup_job_id: string | null;
  tier_label: string;
  bill_discount_pct: number;
  discount_cents: number;
  bill_dollars: number | null;
  enrolled_by_tech: string;
  cadence: "monthly" | "annual";
}): Promise<void> {
  const supabase = db();
  const { data: kelsey } = await supabase
    .from("tech_directory")
    .select("slack_user_id, tech_short_name")
    .eq("tech_short_name", "Kelsey")
    .eq("is_active", true)
    .maybeSingle();

  const recipient = (kelsey?.slack_user_id as string | null) ?? null;

  // Build the human message
  const discountDollars = (input.discount_cents / 100).toLocaleString();
  const billLine = input.bill_dollars != null
    ? `\n• Bill at signup: *$${input.bill_dollars.toLocaleString()}*`
    : "";
  const jobLink = input.signup_job_id
    ? `\n• Job: <https://tpar-dashboard.vercel.app/job/${input.signup_job_id}|${input.signup_job_id.slice(0, 14)}…>`
    : "";

  const text = [
    `🎟️ New TPAR membership signup — needs discount applied in HCP`,
    ``,
    `• Customer: <https://tpar-dashboard.vercel.app/customer/${input.hcp_customer_id}|view>`,
    `• Tier: *${input.tier_label}* (${input.bill_discount_pct}% discount)`,
    `• Cadence: ${input.cadence}`,
    `• Enrolled by: ${input.enrolled_by_tech}`,
    billLine,
    `• Discount to apply: *$${discountDollars}*` + (input.bill_dollars != null ? ` (= ${input.bill_discount_pct}% of bill)` : ""),
    jobLink,
    ``,
    `_Please add the discount line to the HCP invoice. Tracked: signup_discount_cents=${input.discount_cents} on membership_subscriptions._`,
  ].filter(Boolean).join("\n");

  const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  await fetch(`${SUPABASE_URL}/functions/v1/notify-danny`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      context: "membership-signup",
      recipient_slack_user_id: recipient,    // null falls back to Danny inside notify-danny
    }),
  }).catch(() => {});
}

export async function cancelMembership(input: {
  subscription_id: string;
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech();
  if (!me?.isAdmin && !me?.isManager) {
    return { ok: false, error: "Only admin or manager can cancel a membership." };
  }
  const supabase = db();
  const { error } = await supabase
    .from("membership_subscriptions")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_reason: input.reason ?? null,
      ended_at: new Date().toISOString(),
    })
    .eq("id", input.subscription_id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
