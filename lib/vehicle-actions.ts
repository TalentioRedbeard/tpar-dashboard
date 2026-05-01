// Server actions for /reports/vehicles. Admin-only writes per Phase 3 Tier 3.
// Mirrors the agreement-actions / admin-actions pattern.

"use server";

import { revalidatePath } from "next/cache";
import { db } from "./supabase";
import { getSessionUser } from "./supabase-server";
import { isAdmin } from "./admin";

export type VehicleResult =
  | { ok: true; id?: string | number }
  | { ok: false; error: string };

const SERVICE_TYPES = new Set(["oil_change","tire_rotation","brakes","tires","inspection","repair","fuel","other"]);

export async function setVehicleDriver(formData: FormData): Promise<VehicleResult> {
  const vehicleId = String(formData.get("vehicle_id") ?? "").trim();
  const driver    = String(formData.get("driver") ?? "").trim();
  if (!vehicleId) return { ok: false, error: "missing vehicle_id" };

  const user = await getSessionUser();
  if (!user?.email) return { ok: false, error: "not signed in" };
  if (!isAdmin(user.email)) return { ok: false, error: "admin only" };

  const supa = db();
  const { error } = await supa
    .from("vehicles_master")
    .update({
      primary_driver_short_name: driver === "" ? null : driver,
      updated_at: new Date().toISOString(),
    })
    .eq("id", vehicleId);
  if (error) return { ok: false, error: error.message };

  await supa.from("maintenance_logs").insert({
    source: "admin-vehicle-edit",
    level: "info",
    message: `vehicle driver assignment changed`,
    context: { vehicle_id: vehicleId, driver: driver || null, author_email: user.email },
  });

  revalidatePath("/reports/vehicles");
  return { ok: true, id: vehicleId };
}

export async function setVehicleOdometer(formData: FormData): Promise<VehicleResult> {
  const vehicleId = String(formData.get("vehicle_id") ?? "").trim();
  const reading   = String(formData.get("odometer") ?? "").trim();
  if (!vehicleId) return { ok: false, error: "missing vehicle_id" };
  const n = Number(reading);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 999_999_999) {
    return { ok: false, error: "odometer must be a non-negative integer" };
  }

  const user = await getSessionUser();
  if (!user?.email) return { ok: false, error: "not signed in" };
  if (!isAdmin(user.email)) return { ok: false, error: "admin only" };

  const supa = db();
  const { error } = await supa
    .from("vehicles_master")
    .update({
      last_known_odometer: n,
      last_known_odometer_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", vehicleId);
  if (error) return { ok: false, error: error.message };

  await supa.from("maintenance_logs").insert({
    source: "admin-vehicle-edit",
    level: "info",
    message: `vehicle odometer set`,
    context: { vehicle_id: vehicleId, odometer: n, author_email: user.email },
  });

  revalidatePath("/reports/vehicles");
  return { ok: true, id: vehicleId };
}

export async function logVehicleService(formData: FormData): Promise<VehicleResult> {
  const vehicleId  = String(formData.get("vehicle_id") ?? "").trim();
  const serviceType= String(formData.get("service_type") ?? "").trim();
  const serviceDate= String(formData.get("service_date") ?? "").trim();
  const subtype    = String(formData.get("service_subtype") ?? "").trim();
  const mileage    = String(formData.get("mileage_at_service") ?? "").trim();
  const cost       = String(formData.get("cost") ?? "").trim();
  const vendor     = String(formData.get("vendor") ?? "").trim();
  const notes      = String(formData.get("notes") ?? "").trim();

  if (!vehicleId) return { ok: false, error: "missing vehicle_id" };
  if (!SERVICE_TYPES.has(serviceType)) return { ok: false, error: "invalid service_type" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return { ok: false, error: "service_date must be YYYY-MM-DD" };

  const user = await getSessionUser();
  if (!user?.email) return { ok: false, error: "not signed in" };
  if (!isAdmin(user.email)) return { ok: false, error: "admin only" };

  // Parse optional numerics
  let mileageInt: number | null = null;
  if (mileage) {
    const m = Number(mileage);
    if (!Number.isFinite(m) || !Number.isInteger(m) || m < 0) return { ok: false, error: "mileage must be a non-negative integer" };
    mileageInt = m;
  }
  let costCents: number | null = null;
  if (cost) {
    const c = Number(cost);
    if (!Number.isFinite(c) || c < 0) return { ok: false, error: "cost must be a non-negative number" };
    costCents = Math.round(c * 100);
  }

  const supa = db();
  const { data, error } = await supa
    .from("vehicle_service_history")
    .insert({
      vehicle_id: vehicleId,
      service_type: serviceType,
      service_date: serviceDate,
      service_subtype: subtype || null,
      mileage_at_service: mileageInt,
      cost_cents: costCents,
      vendor: vendor || null,
      notes: notes || null,
      author_email: user.email,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  // If a mileage was provided AND it's higher than the vehicle's known
  // last odometer, also bump the vehicle's last_known_odometer to this
  // service's mileage. That keeps the estimated_current_odometer fresh.
  if (mileageInt !== null) {
    const { data: prior } = await supa
      .from("vehicles_master")
      .select("last_known_odometer")
      .eq("id", vehicleId)
      .maybeSingle();
    const priorReading = (prior?.last_known_odometer as number | null) ?? 0;
    if (mileageInt > priorReading) {
      await supa
        .from("vehicles_master")
        .update({
          last_known_odometer: mileageInt,
          last_known_odometer_at: new Date(serviceDate).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", vehicleId);
    }
  }

  await supa.from("maintenance_logs").insert({
    source: "admin-vehicle-edit",
    level: "info",
    message: `vehicle service logged: ${serviceType}`,
    context: {
      vehicle_id: vehicleId, service_id: data?.id, service_type: serviceType,
      service_date: serviceDate, mileage_at_service: mileageInt, cost_cents: costCents,
      author_email: user.email,
    },
  });

  revalidatePath("/reports/vehicles");
  return { ok: true, id: data?.id };
}
