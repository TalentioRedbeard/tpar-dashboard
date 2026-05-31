"use server";

// Fleet / dispatch assignment (Danny 2026-05-31). Assign a technician to a
// vehicle from the "Today's lanes" selection bar. One tech ↔ one vehicle:
// assigning clears that tech off any other vehicle. If a today's job is also
// picked, a dispatch task captures the plan (tech → job in that vehicle) for
// follow-through — moving the HCP appointment itself is the bot-write piece (v2).

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type FleetResult = { ok: true } | { ok: false; error: string };

async function gate(): Promise<{ name: string } | { error: string }> {
  const me = await getCurrentTech();
  if (!me) return { error: "not signed in" };
  if (!(me.isAdmin || me.isManager || me.tech?.is_lead)) return { error: "dispatch role required (admin/manager/lead)" };
  return { name: me.tech?.tech_short_name ?? me.email.split("@")[0] };
}

export async function assignVehicle(
  techShortName: string,
  vehicleId: string,
  opts?: { jobLabel?: string; vehicleName?: string },
): Promise<FleetResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const tech = techShortName.trim();
  if (!tech) return { ok: false, error: "Pick a technician." };
  if (!vehicleId) return { ok: false, error: "Pick a vehicle." };

  const supa = db();
  const now = new Date().toISOString();
  // One tech ↔ one vehicle: clear this tech off any other vehicle first.
  await supa.from("vehicles_master")
    .update({ primary_driver_short_name: null, updated_at: now })
    .eq("primary_driver_short_name", tech)
    .neq("id", vehicleId);
  const { error } = await supa.from("vehicles_master")
    .update({ primary_driver_short_name: tech, updated_at: now })
    .eq("id", vehicleId);
  if (error) return { ok: false, error: error.message };

  const jobLabel = opts?.jobLabel?.trim();
  if (jobLabel) {
    await supa.from("tasks").insert({
      title: `🚚 ${tech} → ${jobLabel}`.slice(0, 300),
      detail: opts?.vehicleName ? `Vehicle: ${opts.vehicleName}` : null,
      assigned_to: tech,
      created_by: g.name,
    });
  }
  revalidatePath("/dispatch");
  return { ok: true };
}

export async function clearVehicleDriver(vehicleId: string): Promise<FleetResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  if (!vehicleId) return { ok: false, error: "No vehicle." };
  const { error } = await db().from("vehicles_master")
    .update({ primary_driver_short_name: null, updated_at: new Date().toISOString() })
    .eq("id", vehicleId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dispatch");
  return { ok: true };
}

// Admin-only inline edit of a vehicle's catalog fields from the fleet strip.
export async function editVehicle(
  vehicleId: string,
  patch: { display_name?: string; primary_driver_short_name?: string | null; last_known_odometer?: number | null; notes?: string | null; is_active?: boolean },
): Promise<FleetResult> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  if (!me.isAdmin) return { ok: false, error: "Only an admin can edit vehicles." };
  if (!vehicleId) return { ok: false, error: "No vehicle." };

  const supa = db();
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { updated_at: now };
  if (patch.display_name !== undefined) {
    const n = patch.display_name.trim();
    if (n) update.display_name = n.slice(0, 120);
  }
  if (patch.primary_driver_short_name !== undefined) {
    update.primary_driver_short_name = patch.primary_driver_short_name?.trim() || null;
  }
  if (patch.last_known_odometer !== undefined) {
    update.last_known_odometer = patch.last_known_odometer != null && Number.isFinite(patch.last_known_odometer) ? Math.round(patch.last_known_odometer) : null;
  }
  if (patch.notes !== undefined) update.notes = patch.notes?.trim().slice(0, 2000) || null;
  if (patch.is_active !== undefined) update.is_active = patch.is_active;

  // Keep one tech <-> one vehicle: if a driver was set here, clear them off others.
  const newDriver = update.primary_driver_short_name as string | null | undefined;
  if (typeof newDriver === "string" && newDriver) {
    await supa.from("vehicles_master").update({ primary_driver_short_name: null, updated_at: now }).eq("primary_driver_short_name", newDriver).neq("id", vehicleId);
  }
  const { error } = await supa.from("vehicles_master").update(update).eq("id", vehicleId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dispatch");
  return { ok: true };
}
