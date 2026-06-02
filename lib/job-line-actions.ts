"use server";

// Web twin of the Slack /estimate-draft flow (#estimate). Lets the team add a
// priced LINE ITEM to a job's HCP invoice from the website — the 4-question
// pricebook path (Service/Project/Diagnostic → category → work type → item) +
// the calc (hours × crew rate + materials × 1.3 markup), pushed via the
// hcp-add-job-line edge function. Mirrors slack-estimate's pricing exactly:
//   crew rate: 1→$185, 2→$250, 3+→$250+(n-2)×$85 ; materials markup 1.30.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type PriceItem = { q1: string; q2: string; q3: string; item: string; ref_price: number; modifiers: string[] };

async function allowed() {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return null;
  return me.isAdmin || me.isManager || me.dashboardRole === "tech" ? me : null;
}

// Crew billing rate per hour (matches slack-estimate estHourlyRateForCrew).
// Local (not exported) — a "use server" module may only export async actions.
function crewHourlyRate(crewSize: number): number {
  if (crewSize <= 1) return 185;
  if (crewSize === 2) return 250;
  return 250 + (crewSize - 2) * 85;
}

// The pricebook options for the cascade. Only rows with a real item name (skip
// classifier placeholders). ref_price is the pricebook's reference sell price
// (shown for context; the actual line price is computed from hours/materials).
export async function getPricebookOptions(): Promise<PriceItem[]> {
  if (!(await allowed())) return [];
  const { data } = await db()
    .from("pricebook_classifications_latest")
    .select("q1_service_type, q2_category, q3_work_type, pb_item_name, pb_sell_price, suggested_modifier_slugs")
    .not("pb_item_name", "is", null)
    .limit(2000);
  const rows = (data ?? []) as Array<{ q1_service_type: string | null; q2_category: string | null; q3_work_type: string | null; pb_item_name: string | null; pb_sell_price: number | null; suggested_modifier_slugs: unknown }>;
  const seen = new Set<string>();
  const out: PriceItem[] = [];
  for (const r of rows) {
    if (!r.q1_service_type || !r.q2_category || !r.q3_work_type || !r.pb_item_name) continue;
    const key = `${r.q1_service_type}|${r.q2_category}|${r.q3_work_type}|${r.pb_item_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const modifiers = Array.isArray(r.suggested_modifier_slugs)
      ? (r.suggested_modifier_slugs as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    out.push({ q1: r.q1_service_type, q2: r.q2_category, q3: r.q3_work_type, item: r.pb_item_name, ref_price: Number(r.pb_sell_price) || 0, modifiers });
  }
  return out;
}

export async function addJobLineItem(input: {
  hcpJobId: string;
  itemName: string;     // pricebook item name OR a custom name
  hours: number;
  crewSize: number;
  materialsCost: number; // pre-markup dollars
  description: string;
}): Promise<{ ok: boolean; error?: string; price?: number }> {
  const me = await allowed();
  if (!me) return { ok: false, error: "Not allowed." };
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, error: "server misconfigured" };

  const name = (input.itemName ?? "").trim();
  const hours = Number(input.hours) || 0;
  const crew = Math.max(1, Math.min(7, Math.round(Number(input.crewSize) || 1)));
  const materials = Math.max(0, Number(input.materialsCost) || 0);
  if (!name) return { ok: false, error: "Pick or name a line item." };
  if (hours <= 0 && materials <= 0) return { ok: false, error: "Enter hours and/or materials." };

  const sellDollars = hours * crewHourlyRate(crew) + materials * 1.3;
  const unit_price_cents = Math.round(sellDollars * 100);
  if (unit_price_cents <= 0) return { ok: false, error: "Price came out to $0 — check inputs." };

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/hcp-add-job-line`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        job_id: input.hcpJobId,
        line_items: [{
          name: name.slice(0, 255),
          description: (input.description ?? "").trim().slice(0, 1000) || undefined,
          unit_price_cents,
          quantity: 1,
          kind: "labor",
          unit_cost_cents: Math.round(materials * 100),
        }],
      }),
    });
    const j = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !j?.ok) {
      const errs = (j?.errors as Array<{ error?: string }> | undefined);
      return { ok: false, error: String(errs?.[0]?.error ?? j?.error ?? `HCP write failed (${res.status})`) };
    }
    revalidatePath(`/job/${input.hcpJobId}`);
    return { ok: true, price: unit_price_cents / 100 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
