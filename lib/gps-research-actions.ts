"use server";

// #26 — owner trigger to research unassociatable van trip-end clusters into
// places (parts/gas/food/home/other) via Google Places. Chunked; re-run to finish.

import { getCurrentTech } from "@/lib/current-tech";
import { isOwner } from "@/lib/admin";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function runEndpointResearch(): Promise<{ ok: boolean; error?: string; researched?: number; remaining?: number; by_category?: Record<string, number>; note?: string }> {
  const me = await getCurrentTech().catch(() => null);
  if (!me || !isOwner(me.realEmail ?? me.email ?? "")) return { ok: false, error: "owner only" };
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, error: "server misconfigured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/research-gps-endpoints`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ max: 120 }),
    });
    const j = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !j?.ok) return { ok: false, error: String(j?.error ?? `research ${res.status}`) };
    return {
      ok: true,
      researched: Number(j.researched ?? 0),
      remaining: Number(j.remaining ?? 0),
      by_category: (j.by_category as Record<string, number>) ?? {},
      note: typeof j.note === "string" ? j.note : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
