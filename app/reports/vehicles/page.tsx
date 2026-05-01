// Fleet vehicles + service-history report.
// Source: vehicles_current_v (joins vehicles_master + bouncie cumulative
// trip mileage) + vehicle_service_history.
//
// v0 is decision-capture: catalog + history + estimated odometer. Auto-projected
// next-service-due alerts are deferred until per-vehicle service rules are
// captured (owner's-manual ingestion is v1).

import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { VehicleServiceForm } from "../../../components/VehicleServiceForm";
import { VehicleDriverPicker } from "../../../components/VehicleDriverPicker";
import { getSessionUser } from "../../../lib/supabase-server";
import { isAdmin } from "../../../lib/admin";

export const metadata = { title: "Fleet vehicles · TPAR-DB" };

type VehicleRow = {
  id: string;
  display_name: string;
  kind: string;
  vehicle: string | null;
  driver: string | null;
  last_known_odometer: number | null;
  last_known_odometer_at: string | null;
  bouncie_miles_since_reading: number | null;
  estimated_current_odometer: number | null;
  is_active: boolean;
  notes: string | null;
  days_since_any_service: number | null;
  days_since_oil_change: number | null;
};

type ServiceRow = {
  id: number;
  vehicle_id: string;
  service_date: string;
  service_type: string;
  service_subtype: string | null;
  mileage_at_service: number | null;
  cost_cents: number | null;
  vendor: string | null;
  notes: string | null;
};

function fmtMiles(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return s.slice(0, 10);
}

function tone(days: number | null, warnAt: number, badAt: number): string {
  if (days == null) return "text-neutral-400";
  if (days >= badAt) return "font-medium text-red-700";
  if (days >= warnAt) return "text-amber-700";
  return "text-emerald-700";
}

export default async function VehiclesReport() {
  const supa = db();
  const user = await getSessionUser();
  const admin = isAdmin(user?.email ?? null);

  const [vehiclesRes, historyRes, techsRes] = await Promise.all([
    supa.from("vehicles_current_v").select("*").order("kind").order("display_name"),
    supa.from("vehicle_service_history").select("*").order("service_date", { ascending: false }).limit(50),
    supa.from("tech_directory").select("tech_short_name").eq("is_active", true).order("tech_short_name"),
  ]);
  const vehicles = (vehiclesRes.data ?? []) as VehicleRow[];
  const history = (historyRes.data ?? []) as ServiceRow[];
  const techShortNames = ((techsRes.data ?? []) as Array<{ tech_short_name: string }>).map((t) => t.tech_short_name);

  const active = vehicles.filter((v) => v.is_active);
  const byVehicle = new Map<string, ServiceRow[]>();
  for (const h of history) {
    if (!byVehicle.has(h.vehicle_id)) byVehicle.set(h.vehicle_id, []);
    byVehicle.get(h.vehicle_id)!.push(h);
  }

  return (
    <PageShell
      title="Fleet vehicles"
      description={`${active.length} active · v0 = decision-capture (catalog + history + estimated odometer). Owner-manual-driven service rules + auto-projected alerts in v1.`}
    >
      <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">Vehicle</th>
              <th className="px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-left">Driver</th>
              <th className="px-3 py-2 text-right">Last known odo</th>
              <th className="px-3 py-2 text-right">Bouncie since</th>
              <th className="px-3 py-2 text-right">Est. current</th>
              <th className="px-3 py-2 text-right">Days since svc</th>
              <th className="px-3 py-2 text-right">Days since oil</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id} className="border-t border-neutral-100">
                <td className="px-3 py-2">
                  <div className="font-medium text-neutral-900">{v.display_name}</div>
                  {v.vehicle && v.vehicle !== v.display_name ? (
                    <div className="text-xs text-neutral-500">{v.vehicle}</div>
                  ) : null}
                  {v.notes ? <div className="mt-0.5 text-xs italic text-neutral-500">{v.notes}</div> : null}
                </td>
                <td className="px-3 py-2 text-xs text-neutral-600">{v.kind}</td>
                <td className="px-3 py-2 text-xs text-neutral-700">
                  {admin ? (
                    <VehicleDriverPicker vehicleId={v.id} currentDriver={v.driver} techShortNames={techShortNames} />
                  ) : (
                    v.driver ?? <span className="text-neutral-400">unassigned</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-neutral-600">
                  {fmtMiles(v.last_known_odometer)}
                  {v.last_known_odometer_at ? (
                    <div className="text-xs text-neutral-400">{fmtDate(v.last_known_odometer_at)}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right text-neutral-600">{fmtMiles(v.bouncie_miles_since_reading)}</td>
                <td className="px-3 py-2 text-right font-medium">{fmtMiles(v.estimated_current_odometer)}</td>
                <td className={`px-3 py-2 text-right ${tone(v.days_since_any_service, 60, 180)}`}>
                  {v.days_since_any_service ?? <span className="text-neutral-400">never</span>}
                </td>
                <td className={`px-3 py-2 text-right ${tone(v.days_since_oil_change, 90, 180)}`}>
                  {v.days_since_oil_change ?? <span className="text-neutral-400">never</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-800">Recent service events ({history.length})</h2>
        {history.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
            No service history captured yet. Manual entry surface coming next.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Vehicle</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Mileage</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-left">Vendor</th>
                  <th className="px-3 py-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const vehicleName = vehicles.find((v) => v.id === h.vehicle_id)?.display_name ?? "—";
                  return (
                    <tr key={h.id} className="border-t border-neutral-100">
                      <td className="px-3 py-2 text-xs">{fmtDate(h.service_date)}</td>
                      <td className="px-3 py-2 font-medium text-neutral-900">{vehicleName}</td>
                      <td className="px-3 py-2 text-xs">
                        {h.service_type}
                        {h.service_subtype ? <span className="text-neutral-500"> · {h.service_subtype}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-600">{fmtMiles(h.mileage_at_service)}</td>
                      <td className="px-3 py-2 text-right">{h.cost_cents != null ? `$${(h.cost_cents / 100).toLocaleString()}` : "—"}</td>
                      <td className="px-3 py-2 text-xs text-neutral-600">{h.vendor ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-neutral-600">{h.notes ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {admin ? (
        <section className="mt-8">
          <VehicleServiceForm
            vehicles={vehicles.map((v) => ({ id: v.id, display_name: v.display_name, estimated_current_odometer: v.estimated_current_odometer }))}
          />
        </section>
      ) : null}

      <p className="mt-6 text-xs text-neutral-500">
        <strong>What&apos;s next:</strong>{" "}
        {vehicles.filter((v) => !v.driver).length > 0 ? `${vehicles.filter((v) => !v.driver).length} vehicles unassigned — click the driver column to set them. ` : ""}
        Receipt-based auto-attribution
        (oil-change / tire-shop receipts), and v1 owner&apos;s-manual ingestion
        for service-rule alerts.
      </p>
    </PageShell>
  );
}
