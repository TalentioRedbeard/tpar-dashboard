"use server";

// Server actions for /admin/rates. Edit-in-place: admin updates the
// amount + scope notes via a small form, server action validates and
// writes to internal_rate_card. The DB trigger logs every change to
// internal_rate_card_history.

import { revalidatePath } from "next/cache";
import { db } from "../../../lib/supabase";
import { getCurrentTech } from "../../../lib/current-tech";

export async function updateRate(formData: FormData): Promise<void> {
  const me = await getCurrentTech();
  if (!me) return;
  // Admin-only writes. Manager + lead can READ rates but not edit.
  if (!me.isAdmin) {
    console.warn(`[updateRate] non-admin attempt by ${me.email}`);
    return;
  }

  const rate_key = String(formData.get("rate_key") ?? "").trim();
  const amount_dollars_raw = String(formData.get("amount_dollars") ?? "").trim();
  const scope_notes = String(formData.get("scope_notes") ?? "").trim() || null;
  const unit = String(formData.get("unit") ?? "").trim();

  if (!rate_key) return;
  const dollars = Number(amount_dollars_raw);
  if (!Number.isFinite(dollars) || dollars < 0) {
    console.warn(`[updateRate] invalid amount: ${amount_dollars_raw}`);
    return;
  }

  // Percent rates: stored as plain integer (e.g. 10 for 10%, 150 for 150%).
  // Money rates: stored in cents.
  const amount_cents = unit === "percent" ? Math.round(dollars) : Math.round(dollars * 100);

  const supabase = db();
  const { error } = await supabase
    .from("internal_rate_card")
    .update({
      amount_cents,
      scope_notes,
      updated_by: me.email ?? "unknown",
    })
    .eq("rate_key", rate_key);

  if (error) {
    console.warn(`[updateRate] ${rate_key}: ${error.message}`);
  }
  revalidatePath("/admin/rates");
}
