"use client";

// GPS adherence prompt (#adherence-engine, 2026-06-02). On the tech's /me job
// card it takes a FRESH phone GPS fix and, if they're at the job site, offers a
// one-tap "Start the job?" — or, once started, "Finished here?" when they've
// left. "Yes" fires the lifecycle trigger FOR them (origin='gps_confirmed', GPS
// evidence in context = audit trail) and mirrors to HCP for 3/6. The point: the
// tech confirms a guess instead of remembering to press a button.
//
// A fresh getCurrentPosition (client) is deliberately used over the van's last
// Bouncie position — the latter is the last *trip end* and can be hours stale.
// Renders nothing unless GPS confirms proximity (or owner demo mode), so only
// the card you're actually at lights up.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fireLifecycleTrigger } from "@/app/me/lifecycle-actions";
import { captureTechLocation } from "@/lib/capture-tech-location";

const START_WITHIN_M = 200;   // arrived at the job site
const FINISH_BEYOND_M = 200;  // left the job site (no dead-zone vs START: 200-300m
                              // used to match NEITHER start nor finish — a tech in
                              // that band saw no prompt at all)

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

type Mode = "start" | "finish";

export function GpsLifecyclePrompt({
  hcpJobId, hcpAppointmentId, hcpCustomerId, customerName, custLat, custLng, firedTriggers, demo = false,
}: {
  hcpJobId: string;
  hcpAppointmentId: string | null;
  hcpCustomerId: string | null;
  customerName: string | null;
  custLat: number | null;
  custLng: number | null;
  firedTriggers: number[];
  demo?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fix, setFix] = useState<{ lat: number; lng: number; dist: number } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [geoErr, setGeoErr] = useState<null | "denied" | "unavailable">(null);

  const started = firedTriggers.includes(3);
  const finished = firedTriggers.includes(6);

  useEffect(() => {
    if (custLat == null || custLng == null) return;
    if ((started && finished) || dismissed) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (cancelled) return;
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, dist: Math.round(distanceM(p.coords.latitude, p.coords.longitude, custLat, custLng)) });
      },
      (e) => { if (!cancelled) setGeoErr(e.code === 1 ? "denied" : "unavailable"); }, // surface a re-enable instead of staying silent
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
    return () => { cancelled = true; };
  }, [custLat, custLng, started, finished, dismissed]);

  // Re-request the GPS fix on a user tap — iOS silently blocks repeat requests
  // from a non-gesture context after a first dismissal, so the button matters.
  const requestFix = () => {
    if (custLat == null || custLng == null || typeof navigator === "undefined" || !navigator.geolocation) return;
    setGeoErr(null);
    navigator.geolocation.getCurrentPosition(
      (p) => setFix({ lat: p.coords.latitude, lng: p.coords.longitude, dist: Math.round(distanceM(p.coords.latitude, p.coords.longitude, custLat, custLng)) }),
      (e) => setGeoErr(e.code === 1 ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  };

  if (dismissed || (started && finished)) return null;

  // Real mode needs a fresh fix + a distance gate. Demo (owner) shows regardless
  // of distance so it can be walked through indoors.
  let mode: Mode | null = null;
  if (demo) mode = !started ? "start" : (!finished ? "finish" : null);
  else if (fix) {
    if (!started && fix.dist <= START_WITHIN_M) mode = "start";
    else if (started && !finished && fix.dist >= FINISH_BEYOND_M) mode = "finish";
  }
  if (!mode) {
    // No proximity prompt. If the job IS geocoded but the tech blocked location,
    // don't go silent on the headline feature — offer a one-tap re-enable. (When
    // there's no geocode, location can't help, so we render nothing and the manual
    // Start button below covers it.)
    if (!started && custLat != null && custLng != null && geoErr) {
      return (
        <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="mr-1">📍</span>
          {geoErr === "denied"
            ? "Turn on location to auto-detect when you arrive."
            : "Couldn't get a GPS fix — tap to retry, or just use Start below."}
          <button type="button" onClick={requestFix}
            className="ml-2 rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100">
            Enable location
          </button>
          {geoErr === "denied"
            ? <span className="ml-1 text-[10px] text-amber-700">— or just use Start below.</span>
            : null}
        </div>
      );
    }
    return null;
  }
  const m: Mode = mode;

  const fire = () => {
    setErr(null);
    const triggerNumber: 3 | 6 = m === "start" ? 3 : 6;
    // Reuse the high-accuracy fix we already hold and pass it so logTechLocation
    // POSTs immediately. Without a fix, captureTechLocation re-acquires async and
    // its late POST races (and loses to) the fireLifecycleTrigger revalidation —
    // the same bug that left tech_locations empty (2026-06-12). Demo mode may have
    // no fix; it then falls back to a self-acquired one (owner test path only).
    captureTechLocation(m === "start" ? "start" : "finish", {
      hcpJobId,
      fix: fix ? { lat: fix.lat, lng: fix.lng } : undefined,
    });
    start(async () => {
      const r = await fireLifecycleTrigger({
        trigger_number: triggerNumber,
        hcp_job_id: hcpJobId,
        hcp_appointment_id: hcpAppointmentId ?? undefined,
        hcp_customer_id: hcpCustomerId ?? undefined,
        origin: "gps_confirmed",
        context: { source: "gps_prompt", kind: m, demo, lat: fix?.lat ?? null, lng: fix?.lng ?? null, dist_m: fix?.dist ?? null },
      });
      if (!r.ok) { setErr(r.error); return; }
      router.refresh();
    });
  };

  const who = customerName ?? "this job";
  const isStart = m === "start";

  return (
    <div className={`mt-2.5 rounded-lg border px-3 py-2 ${isStart ? "border-blue-300 bg-blue-50" : "border-emerald-300 bg-emerald-50"}`}>
      <div className="flex items-start gap-2">
        <span className="text-base leading-none">📍</span>
        <p className={`flex-1 text-xs ${isStart ? "text-blue-900" : "text-emerald-900"}`}>
          {isStart ? (
            <>Looks like you&apos;re at <span className="font-semibold">{who}</span>{fix ? ` (${fix.dist}m)` : ""}. Start the job?</>
          ) : (
            <>Looks like you&apos;ve left <span className="font-semibold">{who}</span>. Finished here?</>
          )}
          {demo ? <span className="ml-1 rounded bg-neutral-200 px-1 text-[9px] font-medium text-neutral-600">demo</span> : null}
        </p>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <button type="button" onClick={fire} disabled={pending}
          className={`rounded-md px-3 py-1 text-xs font-semibold text-white disabled:opacity-50 ${isStart ? "bg-blue-600 hover:bg-blue-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
          {pending ? "…" : isStart ? "Yes, start" : "Yes, finished"}
        </button>
        <button type="button" onClick={() => setDismissed(true)} disabled={pending}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50">
          Not yet
        </button>
        {err ? <span className="text-[10px] text-red-600">{err}</span> : null}
      </div>
      <p className="mt-1 text-[10px] text-neutral-500">Confirmed by you, logged with GPS{isStart || m === "finish" ? " · syncs to HCP" : ""}.</p>
    </div>
  );
}
