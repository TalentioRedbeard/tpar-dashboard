"use client";

// DispatchMap — Google Maps view above the /dispatch lanes.
//
// Customer pins: today's appointments with geocoded cust_lat/cust_lng.
// Van pins:      each active vehicle's latest known GPS position.
// Color-coded:   each tech-lane gets a stable color so customer pins and
//                van pins for the same tech visually link to the lane.
//
// Requires NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in env (Vercel + local).
// Without it the map renders a placeholder pointing to setup steps.

import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow } from "@vis.gl/react-google-maps";
import { useMemo, useState } from "react";

export type CustomerPin = {
  appointment_id: string | null;
  hcp_job_id: string | null;
  customer_name: string | null;
  street: string | null;
  city: string | null;
  scheduled_start: string;
  status: string | null;
  tech_primary_name: string | null;
  lat: number;
  lng: number;
};

export type VanPin = {
  vehicle_id: string;
  display_name: string;
  driver_short_name: string | null;
  driver_full_name: string | null;
  lat: number;
  lng: number;
  last_seen_at: string;
};

type Props = {
  customers: CustomerPin[];
  vans: VanPin[];
};

// Fixed palette so the same tech always gets the same color across pin + lane.
const TECH_COLORS = [
  "#2563eb", // blue
  "#16a34a", // green
  "#dc2626", // red
  "#9333ea", // purple
  "#ea580c", // orange
  "#0891b2", // cyan
  "#ca8a04", // amber
  "#be185d", // pink
];

function colorForTech(name: string | null | undefined, allTechs: string[]): string {
  if (!name) return "#6b7280"; // gray for unassigned
  const idx = allTechs.indexOf(name);
  if (idx === -1) return "#6b7280";
  return TECH_COLORS[idx % TECH_COLORS.length];
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function DispatchMap({ customers, vans }: Props) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const [activePin, setActivePin] = useState<{ kind: "customer" | "van"; id: string } | null>(null);

  const techList = useMemo(() => {
    const set = new Set<string>();
    for (const c of customers) if (c.tech_primary_name) set.add(c.tech_primary_name);
    for (const v of vans) if (v.driver_full_name) set.add(v.driver_full_name);
    return Array.from(set).sort();
  }, [customers, vans]);

  // Center on Tulsa shop if no pins, else center on mean of all pins.
  const center = useMemo(() => {
    const pts = [
      ...customers.map((c) => ({ lat: c.lat, lng: c.lng })),
      ...vans.map((v) => ({ lat: v.lat, lng: v.lng })),
    ];
    if (pts.length === 0) return { lat: 36.1522, lng: -95.9886 }; // Tulsa
    const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    return { lat, lng };
  }, [customers, vans]);

  if (!apiKey) {
    return (
      <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-semibold">Map unavailable — Google Maps API key not set</div>
        <p className="mt-1 text-amber-900/80">
          Add <code className="rounded bg-white px-1">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in
          Vercel env vars + local <code className="rounded bg-white px-1">.env.local</code>.
          Enable &quot;Maps JavaScript API&quot; in Google Cloud Console and restrict the key to
          <code className="ml-1 rounded bg-white px-1">tpar-dashboard.vercel.app</code> + your dev hosts.
        </p>
      </div>
    );
  }

  const activeCustomer = activePin?.kind === "customer"
    ? customers.find((c) => (c.appointment_id ?? c.hcp_job_id) === activePin.id)
    : null;
  const activeVan = activePin?.kind === "van"
    ? vans.find((v) => v.vehicle_id === activePin.id)
    : null;

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
      <APIProvider apiKey={apiKey}>
        <div className="h-[420px] w-full">
          <Map
            defaultCenter={center}
            defaultZoom={customers.length + vans.length > 0 ? 11 : 10}
            mapId="tpar-dispatch"
            gestureHandling="greedy"
            disableDefaultUI={false}
            mapTypeControl={true}
            streetViewControl={false}
            fullscreenControl={true}
          >
            {customers.map((c) => {
              const id = c.appointment_id ?? c.hcp_job_id ?? `${c.lat},${c.lng}`;
              const color = colorForTech(c.tech_primary_name, techList);
              return (
                <AdvancedMarker
                  key={`cust-${id}`}
                  position={{ lat: c.lat, lng: c.lng }}
                  onClick={() => setActivePin({ kind: "customer", id })}
                  title={`${fmtTime(c.scheduled_start)} · ${c.customer_name ?? "Customer"} · ${c.tech_primary_name ?? "?"}`}
                >
                  <Pin background={color} borderColor="#000000" glyphColor="#ffffff" />
                </AdvancedMarker>
              );
            })}
            {vans.map((v) => {
              const color = colorForTech(v.driver_full_name, techList);
              return (
                <AdvancedMarker
                  key={`van-${v.vehicle_id}`}
                  position={{ lat: v.lat, lng: v.lng }}
                  onClick={() => setActivePin({ kind: "van", id: v.vehicle_id })}
                  title={`${v.display_name} · ${v.driver_short_name ?? "—"} · ${fmtAgo(v.last_seen_at)}`}
                >
                  {/* Square-ish marker via Pin scale + glyph emoji distinguishes vans from customer pins */}
                  <Pin background={color} borderColor="#000000" glyphColor="#ffffff" scale={1.4}>
                    <span style={{ fontSize: 14, lineHeight: 1 }}>🚐</span>
                  </Pin>
                </AdvancedMarker>
              );
            })}
            {activeCustomer && (
              <InfoWindow
                position={{ lat: activeCustomer.lat, lng: activeCustomer.lng }}
                onCloseClick={() => setActivePin(null)}
              >
                <div className="text-sm">
                  <div className="font-semibold text-neutral-900">
                    {activeCustomer.customer_name ?? "Customer"}
                  </div>
                  <div className="text-xs text-neutral-700">
                    {fmtTime(activeCustomer.scheduled_start)} · {activeCustomer.status ?? "—"}
                  </div>
                  {activeCustomer.street ? (
                    <div className="text-xs text-neutral-600">
                      {activeCustomer.street}{activeCustomer.city ? `, ${activeCustomer.city}` : ""}
                    </div>
                  ) : null}
                  <div className="text-xs text-neutral-500">{activeCustomer.tech_primary_name ?? "Unassigned"}</div>
                  {activeCustomer.hcp_job_id ? (
                    <a
                      href={`/job/${activeCustomer.hcp_job_id}`}
                      className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline"
                    >
                      Open job →
                    </a>
                  ) : null}
                </div>
              </InfoWindow>
            )}
            {activeVan && (
              <InfoWindow
                position={{ lat: activeVan.lat, lng: activeVan.lng }}
                onCloseClick={() => setActivePin(null)}
              >
                <div className="text-sm">
                  <div className="font-semibold text-neutral-900">{activeVan.display_name}</div>
                  <div className="text-xs text-neutral-700">
                    Driver: {activeVan.driver_short_name ?? "—"}
                  </div>
                  <div className="text-xs text-neutral-500">Last seen {fmtAgo(activeVan.last_seen_at)}</div>
                </div>
              </InfoWindow>
            )}
          </Map>
        </div>
      </APIProvider>
      <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 px-3 py-2 text-xs text-neutral-600">
        <span><span className="inline-block h-2 w-2 rounded-full bg-blue-600"></span> Customer pin</span>
        <span>🚐 Van pin</span>
        <span className="text-neutral-400">·</span>
        <span>{customers.length} customer{customers.length === 1 ? "" : "s"} on map</span>
        <span>·</span>
        <span>{vans.length} van{vans.length === 1 ? "" : "s"}</span>
        {techList.length > 0 && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {techList.map((t, i) => (
              <span key={t} className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: TECH_COLORS[i % TECH_COLORS.length] }}></span>
                {t.split(" ")[0]}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
