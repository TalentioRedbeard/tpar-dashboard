"use client";

// Rail-sized location card for the estimate page (layout B): Street View
// photo on top ("to jog the user's memory, or to see what the house looks
// like" — Danny), small pinned map beneath when the address has a geocode
// (scheduled estimates inherit it from their appointment row). Same key and
// degrade-behavior as JobSiteCard: a failed Street View hides itself, a
// missing geocode shows the photo only, a missing address shows nothing loud.

import { useState } from "react";
import { APIProvider, Map, AdvancedMarker, Pin } from "@vis.gl/react-google-maps";

const SHOP = { lat: 36.152588, lng: -95.970938 };

export function EstimateSiteCard({
  addressLine,
  lat,
  lng,
  customerName,
}: {
  addressLine: string | null;
  lat: number | null;
  lng: number | null;
  customerName: string | null;
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const [svFailed, setSvFailed] = useState(false);
  const hasGeo = typeof lat === "number" && typeof lng === "number";
  const svLocation = hasGeo ? `${lat},${lng}` : addressLine;

  if (!addressLine && !hasGeo) return null;

  const streetViewUrl =
    apiKey && svLocation
      ? `https://maps.googleapis.com/maps/api/streetview?size=560x280&fov=80&location=${encodeURIComponent(svLocation)}&key=${apiKey}`
      : null;
  const directionsUrl = addressLine
    ? `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(addressLine)}`
    : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      {streetViewUrl && !svFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={streetViewUrl}
          alt={`Street view of ${addressLine ?? "the site"}`}
          onError={() => setSvFailed(true)}
          className="h-36 w-full object-cover"
        />
      ) : null}
      {apiKey && hasGeo ? (
        <div className="h-32 w-full">
          <APIProvider apiKey={apiKey}>
            <Map
              defaultCenter={{ lat: lat as number, lng: lng as number }}
              defaultZoom={12}
              mapId="tpar-dispatch"
              gestureHandling="cooperative"
              disableDefaultUI
            >
              <AdvancedMarker position={{ lat: lat as number, lng: lng as number }} title={customerName ?? "Site"}>
                <Pin background="#2563eb" borderColor="#000000" glyphColor="#ffffff" />
              </AdvancedMarker>
              <AdvancedMarker position={SHOP} title="Shop">
                <Pin background="#6b7280" borderColor="#000000" glyphColor="#ffffff" />
              </AdvancedMarker>
            </Map>
          </APIProvider>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0 truncate text-xs text-neutral-600">{addressLine ?? "No address on file"}</span>
        {directionsUrl ? (
          <a
            href={directionsUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-md border border-teal-300 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800 hover:bg-teal-100"
          >
            🧭 Directions
          </a>
        ) : null}
      </div>
    </div>
  );
}
