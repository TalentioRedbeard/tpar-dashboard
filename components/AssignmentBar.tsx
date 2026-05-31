"use client";

// Today's-lanes assignment bar (Danny 2026-05-31): select technician + vehicle
// (+ optional job) → assign. One tech ↔ one vehicle. Current driver→vehicle
// pairings show as removable chips. Drag-and-drop is the planned v2; this bar is
// the v1 Danny asked for.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignVehicle, clearVehicleDriver } from "../lib/fleet";

type Tech = { short_name: string; full_name: string };
type Vehicle = { id: string; display_name: string; primary_driver_short_name: string | null; kind: string };
type Job = { value: string; label: string };

const kindIcon = (k: string) => (k === "truck" ? "🛻" : k === "excavator" ? "🚜" : "🚐");

export function AssignmentBar({ techs, vehicles, jobs }: { techs: Tech[]; vehicles: Vehicle[]; jobs: Job[] }) {
  const router = useRouter();
  const [tech, setTech] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [job, setJob] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function submit() {
    if (!tech || !vehicleId) { setMsg("Pick a technician and a vehicle."); return; }
    const v = vehicles.find((x) => x.id === vehicleId);
    const j = jobs.find((x) => x.value === job);
    setMsg(null);
    start(async () => {
      const r = await assignVehicle(tech, vehicleId, { jobLabel: j?.label, vehicleName: v?.display_name });
      if (r.ok) { setMsg("Assigned ✓"); setTech(""); setVehicleId(""); setJob(""); router.refresh(); setTimeout(() => setMsg(null), 1500); }
      else setMsg(r.error);
    });
  }

  function clear(id: string) {
    start(async () => { await clearVehicleDriver(id); router.refresh(); });
  }

  const assigned = vehicles.filter((v) => v.primary_driver_short_name);

  return (
    <div className="mb-3 rounded-2xl border border-neutral-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-[11px] font-medium text-neutral-500">
          Technician
          <select value={tech} onChange={(e) => setTech(e.target.value)} className="mt-0.5 rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-900">
            <option value="">Select technician…</option>
            {techs.map((t) => <option key={t.short_name} value={t.short_name}>{t.short_name}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-[11px] font-medium text-neutral-500">
          Vehicle
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="mt-0.5 rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-900">
            <option value="">Select vehicle…</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{kindIcon(v.kind)} {v.display_name}{v.primary_driver_short_name ? ` · ${v.primary_driver_short_name}` : ""}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-[11px] font-medium text-neutral-500">
          Job <span className="font-normal text-neutral-400">(optional)</span>
          <select value={job} onChange={(e) => setJob(e.target.value)} className="mt-0.5 max-w-[16rem] rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-900">
            <option value="">No job</option>
            {jobs.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={submit} disabled={pending} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {pending ? "…" : "Assign"}
        </button>
        {msg ? <span className="text-xs text-neutral-600">{msg}</span> : null}
      </div>
      {assigned.length ? (
        <div className="flex flex-wrap gap-1.5">
          {assigned.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs text-neutral-700">
              {kindIcon(v.kind)} <strong className="font-semibold">{v.primary_driver_short_name}</strong> · {v.display_name}
              <button type="button" onClick={() => clear(v.id)} disabled={pending} className="ml-0.5 text-neutral-400 hover:text-red-600" title="Unassign">✕</button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
