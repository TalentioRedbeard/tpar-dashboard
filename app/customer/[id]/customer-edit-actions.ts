"use server";

// Customer-basics editing for admin/management (Danny 2026-07-21, Part 3 of
// SPEC_2026-07-21_TIME_PRECISE_DRAG_MGR_EDIT). HCP-owned basics write THROUGH to
// HCP via the update-hcp-customer edge fn (so the edit survives the next sync);
// TPAR-only concepts land in customer_overrides (sync never touches them). Tech
// role is read-only — this is gated to isAdmin || isManager.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type CustomerBasicsInput = {
  hcp_customer_id: string;
  // HCP-owned (write-through)
  first_name?: string;
  last_name?: string;
  email?: string;
  mobile_number?: string;
  address?: { address_id?: string; street?: string; street_line_2?: string; city?: string; state?: string; zip?: string };
  // TPAR-local (sync-safe overrides)
  display_name_override?: string | null;
  preferred_name?: string | null;
  do_not_text?: boolean;
  do_not_call?: boolean;
};

export type CustomerOverrides = {
  display_name_override: string | null;
  preferred_name: string | null;
  do_not_text: boolean;
  do_not_call: boolean;
};

export async function editCustomerBasics(
  input: CustomerBasicsInput,
): Promise<{ ok: boolean; error?: string; changed?: string[] }> {
  const me = await getCurrentTech().catch(() => null);
  // MGMT gate — admin|manager only (techs are read-only on customer basics).
  if (!(me?.isAdmin || me?.isManager)) {
    return { ok: false, error: "Only managers or admins can edit customer info." };
  }
  const id = (input.hcp_customer_id ?? "").trim();
  if (!id) return { ok: false, error: "Missing customer." };
  const actor = me.tech?.tech_short_name ?? me.email ?? "manager";

  // --- HCP write-through (name / email / mobile / address) ------------------
  const hcpBody: Record<string, unknown> = { hcp_customer_id: id, actor };
  let hasHcp = false;
  if (input.first_name !== undefined)    { hcpBody.first_name = input.first_name; hasHcp = true; }
  if (input.last_name !== undefined)     { hcpBody.last_name = input.last_name; hasHcp = true; }
  if (input.email !== undefined)         { hcpBody.email = input.email; hasHcp = true; }
  if (input.mobile_number !== undefined) { hcpBody.mobile_number = input.mobile_number; hasHcp = true; }
  if (input.address && Object.values(input.address).some((v) => v !== undefined)) {
    hcpBody.address = input.address; hasHcp = true;
  }

  const changed: string[] = [];
  if (hasHcp) {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return { ok: false, error: "Server isn't configured to write to HCP (missing service-role key)." };
    let res: Response;
    try {
      res = await fetch(`${SUPABASE_URL}/functions/v1/update-hcp-customer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
        body: JSON.stringify(hcpBody),
      });
    } catch (e) {
      return { ok: false, error: `Couldn't reach the HCP update service: ${e instanceof Error ? e.message : String(e)}` };
    }
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; changed?: string[] };
    if (!res.ok || !j?.ok) return { ok: false, error: j?.error ?? `HCP update failed (${res.status}).` };
    changed.push(...(j.changed ?? []));
  }

  // --- TPAR-local overrides (sync-safe) -------------------------------------
  const ov: Record<string, unknown> = {};
  if (input.display_name_override !== undefined) ov.display_name_override = input.display_name_override?.trim() || null;
  if (input.preferred_name !== undefined)        ov.preferred_name = input.preferred_name?.trim() || null;
  if (input.do_not_text !== undefined)           ov.do_not_text = !!input.do_not_text;
  if (input.do_not_call !== undefined)           ov.do_not_call = !!input.do_not_call;
  if (Object.keys(ov).length > 0) {
    ov.hcp_customer_id = id;
    ov.updated_by = actor;
    ov.updated_at = new Date().toISOString();
    const { error } = await db().from("customer_overrides").upsert(ov, { onConflict: "hcp_customer_id" });
    if (error) return { ok: false, error: error.message };
    changed.push("overrides");
  }

  if (changed.length === 0) return { ok: true, changed: [] };
  revalidatePath(`/customer/${id}`);
  return { ok: true, changed };
}
