"use client";

// AskResult — renders the structured output from appguide-route.
// Three kinds: text / map / table. Map reuses the @vis.gl/react-google-maps
// stack (already used by DispatchMap).

import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow } from "@vis.gl/react-google-maps";
import { useMemo, useState } from "react";

export type RoutePlan = {
  kind: "text" | "map" | "table";
  title: string;
  narrative: string;
  sql?: string;
  map_fields?: { lat?: string; lng?: string; label?: string; subtitle?: string };
  columns?: string[];
};

type Props = {
  plan: RoutePlan;
  rows: Record<string, unknown>[];
  sqlError?: string | null;
};

export function AskResult({ plan, rows, sqlError }: Props) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="mb-3 flex items-baseline gap-2">
        <h3 className="text-base font-semibold text-neutral-900">{plan.title}</h3>
        <span className="ml-auto rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
          {plan.kind}
        </span>
      </div>
      {plan.narrative && (
        <p className="mb-4 text-sm leading-relaxed text-neutral-700">{plan.narrative}</p>
      )}

      {sqlError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <span className="font-medium">SQL error:</span> {sqlError}
        </div>
      ) : null}

      {plan.kind === "map" && !sqlError && (
        <RouteMap rows={rows} fields={plan.map_fields ?? {}} />
      )}
      {plan.kind === "table" && !sqlError && (
        <RouteTable rows={rows} columns={plan.columns ?? null} />
      )}

      {plan.sql ? (
        <details className="mt-4 rounded-md bg-neutral-50 p-2 text-xs">
          <summary className="cursor-pointer text-neutral-600">SQL used</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-white p-2 font-mono text-[11px] text-neutral-800">{plan.sql}</pre>
        </details>
      ) : null}
    </div>
  );
}

function RouteMap({ rows, fields }: { rows: Record<string, unknown>[]; fields: { lat?: string; lng?: string; label?: string; subtitle?: string } }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const [active, setActive] = useState<number | null>(null);

  const latKey = fields.lat ?? "lat";
  const lngKey = fields.lng ?? "lng";
  const labelKey = fields.label ?? "label";

  type Pt = { lat: number; lng: number; label: string; subtitle: string; idx: number };
  const points: Pt[] = useMemo(() => {
    const pts: Pt[] = [];
    rows.forEach((r, i) => {
      const lat = Number(r[latKey]);
      const lng = Number(r[lngKey]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      pts.push({
        lat, lng,
        label: String(r[labelKey] ?? `Row ${i + 1}`),
        subtitle: fields.subtitle ? String(r[fields.subtitle] ?? "") : "",
        idx: i,
      });
    });
    return pts;
  }, [rows, latKey, lngKey, labelKey, fields.subtitle]);

  const center = useMemo(() => {
    if (points.length === 0) return { lat: 36.1522, lng: -95.9886 };
    const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
    return { lat, lng };
  }, [points]);

  if (!apiKey) {
    return <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Google Maps API key missing. Add <code className="rounded bg-white px-1">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>.</div>;
  }

  if (points.length === 0) {
    return <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">No rows with valid coordinates returned.</div>;
  }

  const activePt = active != null ? points.find((p) => p.idx === active) : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200">
      <APIProvider apiKey={apiKey}>
        <div className="h-[480px] w-full">
          <Map
            defaultCenter={center}
            defaultZoom={points.length > 0 ? 11 : 10}
            mapId="tpar-ask-result"
            gestureHandling="greedy"
            mapTypeControl={true}
            streetViewControl={false}
            fullscreenControl={true}
          >
            {points.map((p) => (
              <AdvancedMarker
                key={p.idx}
                position={{ lat: p.lat, lng: p.lng }}
                onClick={() => setActive(p.idx)}
              >
                <Pin background="#2563eb" borderColor="#1d4ed8" glyphColor="#fff" />
              </AdvancedMarker>
            ))}
            {activePt && (
              <InfoWindow
                position={{ lat: activePt.lat, lng: activePt.lng }}
                onCloseClick={() => setActive(null)}
              >
                <div className="text-xs">
                  <div className="font-medium text-neutral-900">{activePt.label}</div>
                  {activePt.subtitle && <div className="text-neutral-600">{activePt.subtitle}</div>}
                </div>
              </InfoWindow>
            )}
          </Map>
        </div>
      </APIProvider>
      <div className="border-t border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600">
        {points.length} point{points.length === 1 ? "" : "s"} · click a pin for details
      </div>
    </div>
  );
}

function RouteTable({ rows, columns }: { rows: Record<string, unknown>[]; columns: string[] | null }) {
  if (rows.length === 0) {
    return <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">No rows.</div>;
  }
  const cols = columns && columns.length > 0 ? columns : Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-200">
      <table className="min-w-full text-sm">
        <thead className="bg-neutral-50 text-left">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-neutral-50">
              {cols.map((c) => (
                <td key={c} className="px-3 py-1.5 tabular-nums text-neutral-800">{formatCell(r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600">
        {rows.length} row{rows.length === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString();
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  try { return JSON.stringify(v); } catch { return String(v); }
}
