"use client";

// Wraps a technician lane card on /dispatch and accepts a vehicle card dragged
// from the VehicleStrip — on drop, assigns that vehicle's driver to this tech.
// When techShortName is null (the Unassigned lane), it's an inert plain wrapper.

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { assignVehicle } from "../lib/fleet";

const VEHICLE_MIME = "application/x-vehicle-id";

export function LaneDropZone({ techShortName, className, children }: { techShortName: string | null; className?: string; children: ReactNode }) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [pending, start] = useTransition();

  if (!techShortName) return <div className={className}>{children}</div>;

  return (
    <div
      className={`${className ?? ""} transition-shadow ${over ? "ring-2 ring-emerald-400 ring-offset-1" : ""} ${pending ? "opacity-70" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(VEHICLE_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(true); }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(VEHICLE_MIME);
        setOver(false);
        if (!id) return;
        e.preventDefault();
        start(async () => { await assignVehicle(techShortName, id); router.refresh(); });
      }}
    >
      {children}
    </div>
  );
}
