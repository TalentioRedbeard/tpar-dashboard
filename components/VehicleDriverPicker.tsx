// Inline driver-assignment picker for a vehicle row.

"use client";

import { useState, useTransition } from "react";
import { setVehicleDriver } from "../lib/vehicle-actions";

export function VehicleDriverPicker({
  vehicleId,
  currentDriver,
  techShortNames,
}: {
  vehicleId: string;
  currentDriver: string | null;
  techShortNames: string[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(currentDriver ?? "");
  const [editing, setEditing] = useState(false);

  function commit(newDriver: string) {
    setError(null);
    const fd = new FormData();
    fd.set("vehicle_id", vehicleId);
    fd.set("driver", newDriver);
    startTransition(async () => {
      const res = await setVehicleDriver(fd);
      if (res.ok) {
        setValue(newDriver);
        setEditing(false);
      } else {
        setError(res.error);
      }
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs text-left hover:underline"
      >
        {value ? value : <span className="text-neutral-400">unassigned</span>}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={isPending}
        className="rounded-md border border-neutral-300 bg-white px-1.5 py-0.5 text-xs focus:border-neutral-900 focus:outline-none"
      >
        <option value="">— unassigned —</option>
        {techShortNames.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => commit(value)}
        disabled={isPending}
        className="rounded-md bg-zinc-900 px-2 py-0.5 text-xs text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {isPending ? "…" : "✓"}
      </button>
      <button
        type="button"
        onClick={() => { setValue(currentDriver ?? ""); setEditing(false); }}
        disabled={isPending}
        className="rounded-md border border-neutral-300 bg-white px-1.5 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50"
      >
        ✕
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}
