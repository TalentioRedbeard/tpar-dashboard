"use client";

// DispatchMap — Google Maps view above the /dispatch lanes.
//
// Customer pins: today's appointments with geocoded cust_lat/cust_lng.
// Van pins:      each active vehicle's latest known GPS position (Bouncie).
// Tech pins:     each tech's latest in-app GPS ping (tech_locations) — fed
//                by the per-action capture on clock/lifecycle buttons.
// Color-coded:   each tech-lane gets a stable color so customer + van + tech
//                pins for the same tech visually link to the lane.
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
  color_hex?: string | null;          // assigned color of the primary/lead tech
  lat: number;
  lng: number;
};

export type VanPin = {
  vehicle_id: string;
  display_name: string;
  driver_short_name: string | null;
  driver_full_name: string | null;
  avatar_url?: string | null;         // driver photo for the marker
  color_hex?: string | null;
  lat: number;
  lng: number;
  last_seen_at: string;
};

export type TechPin = {
  id: string;                         // tech_email
  tech_short_name: string | null;
  tech_full_name: string | null;      // for stable color mapping vs lanes
  avatar_url?: string | null;         // tech photo for the marker
  color_hex?: string | null;          // assigned color
  lat: number;
  lng: number;
  last_action: string;                // e.g. 'start', 'omw', 'finish'
  last_at: string;                    // captured_at ISO
  hcp_job_id: string | null;
};

type Props = {
  customers: CustomerPin[];
  vans: VanPin[];
  techs: TechPin[];
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

function initials(name: string | null | undefined): string {
  const p = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
}

// Round photo marker (tech / van) with a colored ring; falls back to a colored
// initials circle when there's no photo. `badge` overlays a small glyph (🚐).
function PhotoMarker({ avatarUrl, color, label, badge, size = 34 }: {
  avatarUrl?: string | null; color: string; label: string | null; badge?: string; size?: number;
}) {
  const ring = `0 0 0 3px ${color}, 0 1px 4px rgba(0,0,0,0.45)`;
  return (
    <div style={{ width: size, height: size, position: "relative" }}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={label ?? ""} width={size} height={size}
          style={{ width: size, height: size, borderRadius: "9999px", objectFit: "cover", boxShadow: ring }} />
      ) : (
        <div style={{ width: size, height: size, borderRadius: "9999px", background: color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: Math.round(size * 0.36), boxShadow: ring }}>
          {initials(label)}
        </div>
      )}
      {badge ? (
        <span style={{ position: "absolute", right: -3, bottom: -3, fontSize: 13, lineHeight: 1, background: "#fff", borderRadius: "9999px", padding: "1px 2px", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>{badge}</span>
      ) : null}
    </div>
  );
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

export function DispatchMap({ customers, vans, techs }: Props) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const [activePin, setActivePin] = useState<{ kind: "customer" | "van" | "tech"; id: string } | null>(null);

  const techList = useMemo(() => {
    const set = new Set<string>();
    for (const c of customers) if (c.tech_primary_name) set.add(c.tech_primary_name);
    for (const v of vans) if (v.driver_full_name) set.add(v.driver_full_name);
    for (const t of techs) if (t.tech_full_name) set.add(t.tech_full_name);
    return Array.from(set).sort();
  }, [customers, vans, techs]);

  // Assigned per-tech colors (from the pins) take priority; index palette is the
  // fallback so the same tech is the same color on the map + lanes + avatars.
  // Plain object (not Map) — `Map` is the imported Google Maps component here.
  const colorByName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of techs) if (t.tech_full_name && t.color_hex) m[t.tech_full_name] = t.color_hex;
    for (const v of vans) if (v.driver_full_name && v.color_hex) m[v.driver_full_name] = v.color_hex;
    for (const c of customers) if (c.tech_primary_name && c.color_hex) m[c.tech_primary_name] = c.color_hex;
    return m;
  }, [techs, vans, customers]);
  const pinColor = (name: string | null | undefined): string =>
    (name ? colorByName[name] : undefined) || colorForTech(name, techList);

  // Center on Tulsa shop if no pins, else center on mean of all pins.
  const center = useMemo(() => {
    const pts = [
      ...customers.map((c) => ({ lat: c.lat, lng: c.lng })),
      ...vans.map((v) => ({ lat: v.lat, lng: v.lng })),
      ...techs.map((t) => ({ lat: t.lat, lng: t.lng })),
    ];
    if (pts.length === 0) return { lat: 36.1522, lng: -95.9886 }; // Tulsa
    const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    return { lat, lng };
  }, [customers, vans, techs]);

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
  const activeTech = activePin?.kind === "tech"
    ? techs.find((t) => t.id === activePin.id)
    : null;

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
      <APIProvider apiKey={apiKey}>
        <div className="h-[420px] w-full">
          <Map
            defaultCenter={center}
            defaultZoom={customers.length + vans.length + techs.length > 0 ? 11 : 10}
            mapId="tpar-dispatch"
            gestureHandling="greedy"
            disableDefaultUI={false}
            mapTypeControl={true}
            streetViewControl={false}
            fullscreenControl={true}
          >
            {customers.map((c) => {
              const id = c.appointment_id ?? c.hcp_job_id ?? `${c.lat},${c.lng}`;
              const color = pinColor(c.tech_primary_name);
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
              const color = pinColor(v.driver_full_name);
              return (
                <AdvancedMarker
                  key={`van-${v.vehicle_id}`}
                  position={{ lat: v.lat, lng: v.lng }}
                  onClick={() => setActivePin({ kind: "van", id: v.vehicle_id })}
                  title={`${v.display_name} · ${v.driver_short_name ?? "—"} · ${fmtAgo(v.last_seen_at)}`}
                >
                  <PhotoMarker avatarUrl={v.avatar_url} color={color} label={v.driver_short_name ?? v.display_name} badge="🚐" size={36} />
                </AdvancedMarker>
              );
            })}
            {techs.map((t) => {
              const color = pinColor(t.tech_full_name);
              return (
                <AdvancedMarker
                  key={`tech-${t.id}`}
                  position={{ lat: t.lat, lng: t.lng }}
                  onClick={() => setActivePin({ kind: "tech", id: t.id })}
                  title={`${t.tech_short_name ?? "tech"} · ${t.last_action} · ${fmtAgo(t.last_at)}`}
                >
                  <PhotoMarker avatarUrl={t.avatar_url} color={color} label={t.tech_short_name} size={34} />
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
            {activeTech && (
              <InfoWindow
                position={{ lat: activeTech.lat, lng: activeTech.lng }}
                onCloseClick={() => setActivePin(null)}
              >
                <div className="text-sm">
                  <div className="font-semibold text-neutral-900">{activeTech.tech_short_name ?? "Tech"}</div>
                  <div className="text-xs text-neutral-700">
                    Last action: <span className="font-mono">{activeTech.last_action}</span> · {fmtAgo(activeTech.last_at)}
                  </div>
                  {activeTech.hcp_job_id ? (
                    <a
                      href={`/job/${activeTech.hcp_job_id}`}
                      className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline"
                    >
                      Open job →
                    </a>
                  ) : null}
                </div>
              </InfoWindow>
            )}
          </Map>
        </div>
      </APIProvider>
      <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 px-3 py-2 text-xs text-neutral-600">
        <span><span className="inline-block h-2 w-2 rounded-full bg-neutral-400"></span> Customer (tinted by tech)</span>
        <span>🚐 Van (photo)</span>
        <span>🧑 Tech (photo)</span>
        <span className="text-neutral-400">·</span>
        <span>{customers.length} customer{customers.length === 1 ? "" : "s"}</span>
        <span>·</span>
        <span>{vans.length} van{vans.length === 1 ? "" : "s"}</span>
        <span>·</span>
        <span>{techs.length} tech ping{techs.length === 1 ? "" : "s"}</span>
        {techList.length > 0 && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {techList.map((t) => (
              <span key={t} className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: pinColor(t) }}></span>
                {t.split(" ")[0]}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
