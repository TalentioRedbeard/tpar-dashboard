"use server";

// #29 v2 — owner-only trigger to run the line-item -> pricebook classification
// backfill (embeds pricebook items + line item names, matches, then refreshes
// the tpar_pricebook tags). Chunked (max per run) so the dashboard action stays
// under function timeouts; re-run until "done".

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { isOwner } from "@/lib/admin";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function runLineItemClassification(): Promise<{ ok: boolean; error?: string; pb_embedded?: number; line_embedded?: number; classified?: number; note?: string }> {
  const me = await getCurrentTech().catch(() => null);
  if (!me || !isOwner(me.realEmail ?? me.email ?? "")) return { ok: false, error: "owner only" };
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, error: "server misconfigured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/classify-job-lineitems`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ max: 800 }),
    });
    const j = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !j?.ok) return { ok: false, error: String(j?.error ?? `classify ${res.status}`) };
    // Refresh the pricebook tag rollup now (the hourly cron also does this).
    await db().rpc("rebuild_pricebook_tags");
    return {
      ok: true,
      pb_embedded: Number(j.pb_embedded ?? 0),
      line_embedded: Number(j.line_embedded ?? 0),
      classified: Number(j.classified ?? 0),
      note: typeof j.note === "string" ? j.note : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
