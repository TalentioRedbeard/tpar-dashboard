// /receipt — web upload flow for paper receipts.
// Mobile-first; uses the device camera capture for photos.

import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { db } from "@/lib/supabase";
import { PageShell } from "@/components/PageShell";
import { ReceiptForm, type ReceiptVehicle } from "./ReceiptForm";

export const dynamic = "force-dynamic";

export default async function ReceiptPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/receipt");

  // B1 (2026-07-16): gas receipts tether to a vehicle + odometer. Roster =
  // active, shared (owner_only excluded — Danny's Equinox stays off this
  // surface), Bouncie-tracked vehicles; latest odometer prefill comes from
  // bouncie_events_raw (vehicles_master.last_known_odometer is NULL fleet-wide
  // — the events stream is the truth). ~7 indexed limit-1 queries; no new view
  // (and none of the new-view grant landmines).
  const supa = db();
  const { data: fleet } = await supa
    .from("vehicles_master")
    .select("id, display_name, primary_driver_short_name, bouncie_vehicle_id")
    .eq("is_active", true)
    .eq("owner_only", false)
    .not("bouncie_vehicle_id", "is", null)
    .not("display_name", "ilike", "%test%")
    .order("display_name");
  const fleetRows = (fleet ?? []) as Array<{
    id: string; display_name: string; primary_driver_short_name: string | null; bouncie_vehicle_id: string;
  }>;
  const vehicles: ReceiptVehicle[] = await Promise.all(
    fleetRows.map(async (v) => {
      const { data: ev } = await supa
        .from("bouncie_events_raw")
        .select("odometer_mi, event_ts_utc")
        .eq("vehicle_id", v.bouncie_vehicle_id)
        .not("odometer_mi", "is", null)
        .order("event_ts_utc", { ascending: false })
        .limit(1)
        .maybeSingle();
      return {
        id: v.id,
        label: v.display_name,
        driver: v.primary_driver_short_name,
        odometer: ev?.odometer_mi != null ? Math.round(Number(ev.odometer_mi)) : null,
        odometerAt: (ev?.event_ts_utc as string | null) ?? null,
      };
    }),
  );
  const myShort = me.tech?.tech_short_name ?? null;
  const defaultVehicleId = myShort
    ? vehicles.find((v) => v.driver && v.driver.toLowerCase() === myShort.toLowerCase())?.id ?? null
    : null;

  return (
    <PageShell
      kicker="Receipt"
      title="Log a receipt"
      description="Snap the receipt, fill the basics, submit. Everything else gets sorted later."
      help={{
        intent: "Log a parts/supplies receipt the minute you get it — snap it, tag it, done. Faster than texting it in.",
        actions: [
          "Photo first: whole receipt in frame, not blurry.",
          "On a job? Type the invoice # from HCP. Shop/van stuff? Tap a chip — gas, tools, office, dining.",
          "Gas: your van pre-picks and the odometer pre-fills — fix it if it's off.",
          "Amount + vendor if you can read them off the paper; skip what you can't — the office sorts the rest.",
          "Submit. It lands on the job's costs and the spend reports on its own.",
        ],
        stuck: <>Upload failed? Try again — resubmitting the same photo won&apos;t double-log it. Still failing, text the photo to Danny so it isn&apos;t lost.</>,
      }}
    >
      <ReceiptForm
        techShortName={me.tech?.tech_short_name ?? me.email}
        canWrite={me.canWrite || me.isManager}
        vehicles={vehicles}
        defaultVehicleId={defaultVehicleId}
      />
    </PageShell>
  );
}
