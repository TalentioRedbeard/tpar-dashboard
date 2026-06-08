// Client-only helper: capture the user's location on a meaningful in-app event
// (clock in/out, OMW/Start/Finish, etc.) and fire-and-forget post it to
// tech_locations via the logTechLocation server action. Silently no-ops if the
// browser denies permission, times out, or doesn't support geolocation. The
// caller's action MUST NOT depend on this finishing.
//
// Action_type convention (free-text, capped at 40 chars server-side):
//   clock_in, clock_out, omw, start, build_estimate, present, finish, done,
//   open_job, voice_note, mark_complete, ...

import { logTechLocation } from "./log-tech-location";

export function captureTechLocation(
  actionType: string,
  opts?: { hcpJobId?: string | null; raw?: Record<string, unknown> | null; fix?: { lat: number; lng: number; accuracyM?: number | null } }
): void {
  if (opts?.fix && Number.isFinite(opts.fix.lat) && Number.isFinite(opts.fix.lng)) {
    void logTechLocation({ actionType, hcpJobId: opts.hcpJobId ?? null, lat: opts.fix.lat, lng: opts.fix.lng, accuracyM: opts.fix.accuracyM ?? null, raw: opts.raw ?? null });
    return;
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      void logTechLocation({
        actionType,
        hcpJobId: opts?.hcpJobId ?? null,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
        raw: opts?.raw ?? null,
      });
    },
    () => { /* permission denied / timeout — silent no-op */ },
    { enableHighAccuracy: false, timeout: 6000, maximumAge: 30_000 }
  );
}
