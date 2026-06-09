"use client";

// Parallel-clocks Phase 1 (docs/CLOCK_SYNC_SPEC_2026-06-08.md): on /me mount,
// ask the server to reconcile the clock button with HCP's LIVE status. If HCP
// shows the tech clocked in but the app thought they were out, the server
// back-fills a TPAR 'in' row; we then router.refresh() so ClockButton picks up
// the new prop and flips to "Clock out" — killing the "9-second blip".
//
// Fully non-blocking: the page already rendered TPAR state. This renders
// nothing and never surfaces an error (the HCP read is advisory). Runs once.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { syncHcpClockStatus } from "@/app/time/actions";

export function HcpClockSync() {
  const router = useRouter();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    syncHcpClockStatus()
      .then((r) => {
        if (r?.changed) router.refresh();
      })
      .catch(() => {
        /* advisory only — never block or surface */
      });
  }, [router]);
  return null;
}
