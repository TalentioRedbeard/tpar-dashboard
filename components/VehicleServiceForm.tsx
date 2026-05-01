// Inline form for logging a vehicle service event. Admin-only via server-action gate.

"use client";

import { useState, useTransition } from "react";
import { logVehicleService } from "../lib/vehicle-actions";

export function VehicleServiceForm({
  vehicles,
}: {
  vehicles: Array<{ id: string; display_name: string; estimated_current_odometer: number | null }>;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | number | null>(null);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [serviceType, setServiceType] = useState("oil_change");
  const [serviceDate, setServiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mileage, setMileage] = useState("");
  const [cost, setCost] = useState("");
  const [vendor, setVendor] = useState("");
  const [subtype, setSubtype] = useState("");
  const [notes, setNotes] = useState("");

  const currentVehicle = vehicles.find((v) => v.id === vehicleId);
  const mileageHint = currentVehicle?.estimated_current_odometer ?? null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSavedId(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await logVehicleService(fd);
      if (res.ok) {
        setSavedId(res.id ?? null);
        setMileage("");
        setCost("");
        setVendor("");
        setSubtype("");
        setNotes("");
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-neutral-800">Log a service event</h3>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="text-xs">
          <span className="mb-1 block font-medium text-neutral-600">Vehicle</span>
          <select
            name="vehicle_id"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.display_name}</option>
            ))}
          </select>
        </label>

        <label className="text-xs">
          <span className="mb-1 block font-medium text-neutral-600">Service type</span>
          <select
            name="service_type"
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          >
            <option value="oil_change">Oil change</option>
            <option value="tire_rotation">Tire rotation</option>
            <option value="brakes">Brakes</option>
            <option value="tires">Tires</option>
            <option value="inspection">Inspection</option>
            <option value="repair">Repair</option>
            <option value="fuel">Fuel</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label className="text-xs">
          <span className="mb-1 block font-medium text-neutral-600">Date</span>
          <input
            type="date"
            name="service_date"
            value={serviceDate}
            onChange={(e) => setServiceDate(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label className="text-xs">
          <span className="mb-1 block font-medium text-neutral-600">
            Mileage{mileageHint != null ? <span className="ml-1 text-neutral-400">(est. {mileageHint.toLocaleString()})</span> : null}
          </span>
          <input
            type="number"
            name="mileage_at_service"
            min={0}
            value={mileage}
            onChange={(e) => setMileage(e.target.value)}
            disabled={isPending}
            placeholder={mileageHint != null ? String(mileageHint) : "e.g., 98355"}
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label className="text-xs">
          <span className="mb-1 block font-medium text-neutral-600">Cost ($)</span>
          <input
            type="number"
            name="cost"
            min={0}
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            disabled={isPending}
            placeholder="89.99"
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label className="text-xs">
          <span className="mb-1 block font-medium text-neutral-600">Vendor</span>
          <input
            type="text"
            name="vendor"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            disabled={isPending}
            placeholder="Discount Tire / Jiffy Lube / in-house"
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label className="text-xs md:col-span-3">
          <span className="mb-1 block font-medium text-neutral-600">Subtype / specifics</span>
          <input
            type="text"
            name="service_subtype"
            value={subtype}
            onChange={(e) => setSubtype(e.target.value)}
            disabled={isPending}
            placeholder="e.g., front pads, all-season install, fluid + filter"
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label className="text-xs md:col-span-3">
          <span className="mb-1 block font-medium text-neutral-600">Notes</span>
          <textarea
            name="notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isPending}
            placeholder="Any additional context for future reference."
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {isPending ? "Saving…" : "Log event"}
        </button>
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
        {savedId && !error ? <span className="text-xs text-emerald-700">Saved · id {savedId}</span> : null}
        <span className="ml-auto text-xs text-neutral-500">If mileage exceeds last-known, the vehicle&apos;s odometer is auto-bumped.</span>
      </div>
    </form>
  );
}
