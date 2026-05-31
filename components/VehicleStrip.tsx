"use client";

// Fleet strip on /dispatch (Danny 2026-05-31). A horizontal bar of cards, one
// per active work vehicle, sitting below the technician lanes. Each card is
// DRAGGABLE — drag it onto a technician's lane to assign that tech as the driver
// (see LaneDropZone). Admins can inline-edit a vehicle (name, driver, odometer,
// notes, active).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editVehicle } from "../lib/fleet";

export type StripVehicle = {
  id: string;
  display_name: string;
  kind: string;
  primary_driver_short_name: string | null;
  last_known_odometer: number | null;
  last_known_odometer_at: string | null;
  is_active: boolean;
  vin: string | null;
  notes: string | null;
};

const kindIcon = (k: string) => (k === "truck" ? "🛻" : k === "excavator" ? "🚜" : "🚐");

export function VehicleStrip({ vehicles, canEdit, techShortNames }: { vehicles: StripVehicle[]; canEdit: boolean; techShortNames: string[] }) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-neutral-800">🚚 Fleet</h3>
        <span className="text-[11px] text-neutral-400">drag a vehicle onto a tech to assign{canEdit ? " · hover ✏️ to edit" : ""}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {vehicles.length === 0 ? (
          <div className="text-sm text-neutral-400">No vehicles.</div>
        ) : (
          vehicles.map((v) => <VehicleCard key={v.id} v={v} canEdit={canEdit} techShortNames={techShortNames} />)
        )}
      </div>
    </div>
  );
}

function VehicleCard({ v, canEdit, techShortNames }: { v: StripVehicle; canEdit: boolean; techShortNames: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [name, setName] = useState(v.display_name);
  const [driver, setDriver] = useState(v.primary_driver_short_name ?? "");
  const [odo, setOdo] = useState(v.last_known_odometer != null ? String(v.last_known_odometer) : "");
  const [notes, setNotes] = useState(v.notes ?? "");
  const [active, setActive] = useState(v.is_active);
  const [msg, setMsg] = useState<string | null>(null);

  function save() {
    setMsg(null);
    start(async () => {
      const r = await editVehicle(v.id, {
        display_name: name,
        primary_driver_short_name: driver || null,
        last_known_odometer: odo.trim() ? Number(odo) : null,
        notes,
        is_active: active,
      });
      if (r.ok) { setEditing(false); router.refresh(); }
      else setMsg(r.error);
    });
  }

  if (editing) {
    return (
      <div className="w-56 shrink-0 rounded-xl border border-neutral-400 bg-white p-2 text-xs shadow-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="mb-1 w-full rounded border border-neutral-300 px-1.5 py-1" />
        <select value={driver} onChange={(e) => setDriver(e.target.value)} className="mb-1 w-full rounded border border-neutral-300 px-1.5 py-1">
          <option value="">— unassigned —</option>
          {techShortNames.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={odo} onChange={(e) => setOdo(e.target.value)} inputMode="numeric" placeholder="Odometer (mi)" className="mb-1 w-full rounded border border-neutral-300 px-1.5 py-1" />
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="mb-1 w-full rounded border border-neutral-300 px-1.5 py-1" />
        <label className="mb-1 flex items-center gap-1.5 text-neutral-600"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={save} disabled={pending} className="flex-1 rounded bg-brand-700 px-2 py-1 font-medium text-white hover:bg-brand-800 disabled:opacity-50">{pending ? "…" : "Save"}</button>
          <button type="button" onClick={() => { setEditing(false); setMsg(null); }} disabled={pending} className="rounded border border-neutral-300 px-2 py-1 text-neutral-600">Cancel</button>
        </div>
        {msg ? <div className="mt-1 text-[10px] text-red-600">{msg}</div> : null}
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("application/x-vehicle-id", v.id); e.dataTransfer.effectAllowed = "move"; }}
      title="Drag onto a technician to assign"
      className={`group w-44 shrink-0 cursor-grab rounded-xl border bg-white p-2 text-xs shadow-sm active:cursor-grabbing ${v.is_active ? "border-neutral-200" : "border-dashed border-neutral-300 opacity-60"}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="truncate font-semibold text-neutral-900">{kindIcon(v.kind)} {v.display_name}</span>
        {canEdit ? (
          <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-neutral-400 opacity-0 hover:text-neutral-700 group-hover:opacity-100" title="Edit vehicle">✏️</button>
        ) : null}
      </div>
      <div className="mt-0.5 text-neutral-600">{v.primary_driver_short_name ? `👤 ${v.primary_driver_short_name}` : <span className="text-neutral-400">unassigned</span>}</div>
      {v.last_known_odometer != null ? <div className="text-[11px] text-neutral-500">{v.last_known_odometer.toLocaleString()} mi</div> : null}
      {v.notes ? <div className="mt-0.5 truncate text-[10px] italic text-neutral-400" title={v.notes}>{v.notes}</div> : null}
    </div>
  );
}
