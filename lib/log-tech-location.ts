"use server";

// Server action: insert one row into tech_locations for the authenticated tech.
// Called fire-and-forget from client components — failure is silent (the main
// action already succeeded; the location ping is auxiliary).

import { db } from "./supabase";
import { getCurrentTech } from "./current-tech";

export async function logTechLocation(input: {
  actionType: string;
  hcpJobId?: string | null;
  lat: number;
  lng: number;
  accuracyM?: number | null;
  raw?: Record<string, unknown> | null;
}): Promise<{ ok: boolean }> {
  const me = await getCurrentTech().catch(() => null);
  if (!me?.email) return { ok: false };
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) return { ok: false };
  if (Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) return { ok: false };
  const action = (input.actionType ?? "").trim().slice(0, 40);
  if (!action) return { ok: false };

  await db().from("tech_locations").insert({
    tech_email: me.email.toLowerCase(),
    tech_short_name: me.tech?.tech_short_name ?? null,
    action_type: action,
    hcp_job_id: input.hcpJobId?.trim() || null,
    lat: input.lat,
    lng: input.lng,
    accuracy_m: input.accuracyM ?? null,
    raw: input.raw ?? null,
  });
  return { ok: true };
}
