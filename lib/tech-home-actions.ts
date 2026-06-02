"use server";

// #26 — owner-only management of tech home addresses (PII). Geocoded server-side
// via the set-tech-home edge fn; the raw coords live only on tech_directory and
// are exposed to dispatch ONLY as distance-from-home (tech_trip_home_v).
// Owner-gated (Danny alone) per the owner-gate-not-admin rule.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { isOwner } from "@/lib/admin";
import { revalidatePath } from "next/cache";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type TechHome = {
  tech_id: string;
  tech_short_name: string;
  home_address: string | null;
  home_lat: number | null;
  home_geocoded_at: string | null;
};

async function owner() {
  const me = await getCurrentTech().catch(() => null);
  if (!me || !isOwner(me.realEmail ?? me.email ?? "")) return null;
  return me;
}

export async function listTechHomes(): Promise<TechHome[]> {
  if (!(await owner())) return [];
  const { data } = await db()
    .from("tech_directory")
    .select("tech_id, tech_short_name, home_address, home_lat, home_geocoded_at")
    .eq("is_active", true)
    .order("tech_short_name", { ascending: true });
  return (data ?? []) as TechHome[];
}

export async function setTechHome(techId: string, address: string): Promise<{ ok: boolean; error?: string; formatted?: string }> {
  if (!(await owner())) return { ok: false, error: "owner only" };
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, error: "server misconfigured" };
  if (!techId) return { ok: false, error: "missing tech" };
  const clear = !address.trim();
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/set-tech-home`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify(clear ? { tech_id: techId, clear: true } : { tech_id: techId, home_address: address }),
    });
    const j = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !j?.ok) return { ok: false, error: String(j?.error ?? `set-tech-home ${res.status}`) };
    revalidatePath("/admin/tech-homes");
    return { ok: true, formatted: typeof j.formatted === "string" ? j.formatted : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
