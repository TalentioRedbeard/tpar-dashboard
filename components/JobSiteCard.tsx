"use client";

// Job site card for /job/[id]: a Google Street View of the address, a small map
// with the client pinned (+ the shop), turn-by-turn directions, and click-to-call
// the client from the business line (gated). Reuses the Maps JS API key already
// wired for /dispatch (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) and the call-bridge action.
//
// Street View uses the Static API and hides itself on error (the API may not be
// enabled on the key), so a missing image never shows a broken box.

import { useState } from "react";
import { APIProvider, Map, AdvancedMarker, Pin } from "@vis.gl/react-google-maps";
import { CallContactButton } from "./CallContactButton";

const SHOP = { lat: 36.152588, lng: -95.970938 };

export function JobSiteCard({
  customerName,
  street,
  city,
  lat,
  lng,
  directionsUrl,
  customerPhone,
  callEnabled,
  hcpJobId,
  hcpCustomerId,
}: {
  customerName: string | null;
  street: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  directionsUrl: string | null;
  customerPhone: string | null;
  callEnabled: boolean;
  hcpJobId: string;
  hcpCustomerId: string | null;
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const addressLine = [street, city].filter(Boolean).join(", ");
  const hasGeo = typeof lat === "number" && typeof lng === "number";
  const svLocation = hasGeo ? `${lat},${lng}` : addressLine;
  const [svFailed, setSvFailed] = useState(false);

  const streetViewUrl =
    apiKey && svLocation
      ? `https://maps.googleapis.com/maps/api/streetview?size=640x320&fov=80&location=${encodeURIComponent(svLocation)}&key=${apiKey}`
      : null;

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-base leading-none">📍</span>
        <h3 className="text-sm font-semibold text-neutral-900">Job site</h3>
        {addressLine ? <span className="text-sm text-neutral-600">· {addressLine}</span> : null}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {directionsUrl ? (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-teal-300 bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800 transition hover:bg-teal-100"
              title="Open turn-by-turn directions to the job site"
            >
              🧭 Directions
            </a>
          ) : null}
          {customerPhone ? (
            <CallContactButton
              phone={customerPhone}
              name={customerName ?? "Client"}
              kind="customer"
              hcpCustomerId={hcpCustomerId ?? undefined}
              hcpJobId={hcpJobId}
              enabled={callEnabled}
            />
          ) : null}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Street View of the address */}
        {streetViewUrl && !svFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={streetViewUrl}
            alt={`Street view of ${addressLine || "the job site"}`}
            onError={() => setSvFailed(true)}
            className="h-44 w-full rounded-xl border border-neutral-200 object-cover"
          />
        ) : (
          <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 text-xs text-neutral-400">
            {addressLine ? "No street view available" : "No address on file"}
          </div>
        )}

        {/* Small map with the client pinned (+ the shop) */}
        {apiKey && hasGeo ? (
          <div className="overflow-hidden rounded-xl border border-neutral-200">
            <APIProvider apiKey={apiKey}>
              <div className="h-44 w-full">
                <Map
                  defaultCenter={{ lat: lat as number, lng: lng as number }}
                  defaultZoom={13}
                  mapId="tpar-dispatch"
                  gestureHandling="cooperative"
                  disableDefaultUI
                >
                  <AdvancedMarker position={{ lat: lat as number, lng: lng as number }} title={customerName ?? "Client"}>
                    <Pin background="#2563eb" borderColor="#000000" glyphColor="#ffffff" />
                  </AdvancedMarker>
                  <AdvancedMarker position={SHOP} title="Shop">
                    <Pin background="#6b7280" borderColor="#000000" glyphColor="#ffffff" />
                  </AdvancedMarker>
                </Map>
              </div>
            </APIProvider>
          </div>
        ) : (
          <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 text-center text-xs text-neutral-400">
            {apiKey ? "Location not geocoded yet" : "Map key not set"}
          </div>
        )}
      </div>
    </div>
  );
}
