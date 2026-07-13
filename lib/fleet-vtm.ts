// vehicle_tech_map sync — the ONE helper every driver-assignment write must
// route through (van-attribution landmine, plan 2026-07-13 section 10:
// /reports/vehicles edited vehicles_master only, silently desyncing GPS
// attribution — the 2023 Sprinter drove six weeks under the wrong tech).
// vehicles_master.primary_driver_short_name is the display copy;
// vehicle_tech_map is the effective-dated truth trip attribution reads.
// Deliberately NOT a "use server" module: it takes a live client and must
// never be a callable action endpoint.
//
// Interval semantics: closes the open row at `now` — right for live
// handoffs. Backdated corrections (yesterday's trips were really X's) stay
// deliberate SQL, like the 7/13 Sprinter fix.

import type { db } from "./supabase";

export async function syncVtm(
  supa: ReturnType<typeof db>,
  vehicleId: string,
  newTech: string | null,
  now: string,
): Promise<void> {
  const { data: v } = await supa.from("vehicles_master").select("bouncie_vehicle_id, vin, imei").eq("id", vehicleId).maybeSingle();
  const bvId = (v?.bouncie_vehicle_id as string | null | undefined) ?? null;
  if (!bvId) return; // no Bouncie device — nothing attributes trips to it
  const { data: openRows } = await supa.from("vehicle_tech_map").select("tech_name").eq("vehicle_id", bvId).is("active_to", null).limit(1);
  const currentDriver = (openRows?.[0]?.tech_name as string | undefined) ?? null;
  if ((newTech ?? null) === (currentDriver ?? null)) return; // already correct
  await supa.from("vehicle_tech_map").update({ active_to: now, updated_at: now }).eq("vehicle_id", bvId).is("active_to", null);
  if (newTech) {
    await supa.from("vehicle_tech_map").insert({
      vehicle_id: bvId, vin: (v?.vin as string) ?? null, imei: (v?.imei as string) ?? null,
      tech_id: newTech.toLowerCase(), tech_name: newTech, assigned_source: "dashboard_assign", active_from: now,
    });
  }
}
