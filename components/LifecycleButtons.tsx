"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fireLifecycleTrigger, getLifecycleHcpStatus, type HcpMirrorStatus } from "@/app/me/lifecycle-actions";
import { bounceHcpAppointments } from "@/lib/bounce-hcp-appointments";
import { getOpenJobForTech, type OpenJob } from "@/lib/omw-guard-actions";
import { OmwGuardModal } from "./OmwGuardModal";
import { PostPresentationChecklist } from "./PostPresentationChecklist";
import { EndOfJobChecklist } from "./EndOfJobChecklist";
import { OnSiteElapsedChip } from "./OnSiteElapsedChip";
import { TriggerStageClock, buildStageWindows, fmtPressTime, type StageEvent } from "./TriggerStageClock";

type Props = {
  hcpJobId: string;
  hcpAppointmentId: string | null;
  // Trigger numbers already fired for this appointment (so we can show completed state)
  firedTriggers: number[];
  // Pre-rendered mirror state per trigger — populated by /me from a server-
  // side query so the pill survives page refreshes. After firing in-session,
  // live polling takes over and updates the same per-trigger entry.
  initialMirrors?: Record<number, {
    fired_at: string;
    state: "pending" | "synced" | "unconfirmed" | "failed";
    message?: string;
    elapsed_ms?: number;
  }>;
  // Job-site destination for the "Directions" deep link (turn-by-turn in the
  // tech's maps app). Address is preferred (Google geocodes it + shows a
  // readable destination); coords are the fallback when no address.
  destAddress?: string | null;
  destLat?: number | null;
  destLng?: number | null;
  // Whether each checklist is already submitted for this job — drives the
  // post-trigger prompt: show the form, or a "✓ on file" chip.
  ppSubmitted?: boolean;
  eojSubmitted?: boolean;
  // Stored fired_at of this job's Start trigger (3), threaded from /me's
  // lifecycle query so the on-site elapsed chip survives reloads.
  startFiredAt?: string | null;
  // Today's lifecycle events for this job (fired_at + origin per trigger),
  // threaded from /me's existing 24h query — powers the per-button stage
  // clocks. fired_by=techName filter upstream means no hcp_derived rows here.
  firedEvents?: Array<{ trigger_number: number; fired_at: string; origin: string | null; fired_by?: string | null }>;
};

type TriggerNum = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const BUTTONS: Array<{
  trigger: TriggerNum;
  label: string;
  variant: "primary" | "secondary" | "danger";
  hint?: string;
}> = [
  { trigger: 2, label: "On my way", variant: "secondary", hint: "Let the customer know you're on the way" },
  { trigger: 3, label: "Start job", variant: "secondary", hint: "Start the job clock" },
  { trigger: 4, label: "Build estimate", variant: "secondary", hint: "Build the estimate" },
  { trigger: 5, label: "Present", variant: "secondary", hint: "Present the estimate to the customer" },
  { trigger: 6, label: "Finish work", variant: "secondary", hint: "Finish the work" },
  { trigger: 7, label: "Done", variant: "primary", hint: "Mark the job done" },
];

// Trigger numbers that mirror to HCP via the bot — show sync status pill
// for these only.
const HCP_MIRRORED_TRIGGERS = new Set<TriggerNum>([2, 3, 6]);

// Universal action_type per trigger # for the tech_locations log. So we can
// later answer "where was the Start button pressed for this job?".
const TRIGGER_ACTION: Record<TriggerNum, string> = {
  1: "trigger_1",
  2: "omw",
  3: "start",
  4: "build_estimate",
  5: "present",
  6: "finish",
  7: "done",
};

// Resolve a fresh GPS fix as an awaitable Promise (mirrors ClockButton.captureLocation).
// We resolve the fix on the client and hand it to fireLifecycleTrigger, which persists
// the tech_locations adherence row SERVER-SIDE via after() — reliable because it rides
// the same awaited action that writes the event. (The old client-side captureTechLocation
// POST ran its own getCurrentPosition fire-and-forget whose late POST raced — and lost —
// to runFire's revalidate, landing 0 lifecycle rows; 2026-06-17 fix.)
function resolveFix(): Promise<{ lat: number; lng: number; accuracyM: number | null } | undefined> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
      () => resolve(undefined),
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60_000 },
    );
  });
}

type MirrorEntry = { firedAt: string; status: HcpMirrorStatus };

export function LifecycleButtons({ hcpJobId, hcpAppointmentId, firedTriggers, initialMirrors, destAddress, destLat, destLng, ppSubmitted, eojSubmitted, startFiredAt, firedEvents }: Props) {
  const [pending, startTransition] = useTransition();
  const [firing, setFiring] = useState<TriggerNum | null>(null);
  const [lastFired, setLastFired] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // On-site elapsed chip: seeded from the stored Start fired_at (reload-safe),
  // set optimistically the instant Start is pressed so the press visibly
  // "took" — the confusion this fixes: "we thought we were hitting start
  // drawing" (Anthony/Landon, 7/16).
  const [startedAt, setStartedAt] = useState<string | null>(startFiredAt ?? null);
  // Per-button stage clocks: optimistic press times merged with the server's
  // rows; runFire adopts the server fired_at on success, rolls back on failure.
  const [pressedAt, setPressedAt] = useState<Record<number, string>>({});
  const hasServerRow = (t: number) => (firedEvents ?? []).some((e) => e.trigger_number === t);
  const clearPressed = (t: number) =>
    setPressedAt((p) => { if (!(t in p)) return p; const q = { ...p }; delete q[t]; return q; });
  // OMW-without-Finish guard: a prior open job to resolve before On-My-Way fires.
  const [guardJob, setGuardJob] = useState<OpenJob | null>(null);
  // Seed mirror state from server-rendered initialMirrors so pills survive
  // page refreshes. After in-session fires, live polling overwrites entries.
  const [mirror, setMirror] = useState<Record<number, MirrorEntry>>(() => {
    if (!initialMirrors) return {};
    const out: Record<number, MirrorEntry> = {};
    for (const [k, v] of Object.entries(initialMirrors)) {
      const t = Number(k);
      out[t] = {
        firedAt: v.fired_at,
        status: {
          state: v.state,
          message: v.message,
          elapsed_ms: v.elapsed_ms,
        },
      };
    }
    return out;
  });

  // Poll mirror status for triggers that are pending. Stops automatically
  // when all pending triggers resolve.
  const pollTimerRef = useRef<number | null>(null);
  useEffect(() => {
    // Find pending ones
    const pendingTriggers: TriggerNum[] = [];
    for (const [t, entry] of Object.entries(mirror)) {
      if (entry.status.state === "pending") pendingTriggers.push(Number(t) as TriggerNum);
    }
    if (pendingTriggers.length === 0) {
      if (pollTimerRef.current) { window.clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
      return;
    }
    // Schedule next poll in 5s
    pollTimerRef.current = window.setTimeout(async () => {
      const updates: Record<number, MirrorEntry> = {};
      for (const t of pendingTriggers) {
        const entry = mirror[t];
        if (!entry) continue;
        const ageMs = Date.now() - new Date(entry.firedAt).getTime();
        // Give up after 5 min — bot run is ~2:30 typical; if no log row by 5
        // min, something's wrong. Caller can refresh page to re-check.
        if (ageMs > 5 * 60 * 1000) {
          // A slow/cold bot is NOT a failed press — the TPAR trigger already
          // succeeded (the button shows ✓). Degrade to a calm amber 'syncing',
          // never a red failure; verify_hcp_mirrors() reconciles against HCP later.
          updates[t] = { firedAt: entry.firedAt, status: { state: "unconfirmed", message: "Your press was saved. HCP is still catching up — it'll sync on its own." } };
          continue;
        }
        try {
          const res = await getLifecycleHcpStatus({
            hcp_job_id: hcpJobId,
            trigger_number: t,
            fired_after: entry.firedAt,
          });
          updates[t] = { firedAt: entry.firedAt, status: res };
        } catch {
          // Network blip — stay pending, retry next tick
        }
      }
      setMirror((prev) => ({ ...prev, ...updates }));
    }, 5000);
    return () => {
      if (pollTimerRef.current) { window.clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
    };
  }, [mirror, hcpJobId]);

  // Bounce-back: when an HCP mirror transitions to 'synced', re-pull
  // appointments so our local view reflects HCP's update without waiting
  // for the half-hourly cron. bouncedRef tracks which triggers we've already
  // bounced so we fire it once per sync transition (not on every re-render).
  const router = useRouter();
  const bouncedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    let didBounce = false;
    for (const [tStr, entry] of Object.entries(mirror)) {
      const t = Number(tStr);
      if (entry.status.state === "synced" && !bouncedRef.current.has(t)) {
        bouncedRef.current.add(t);
        didBounce = true;
      }
    }
    if (didBounce) {
      void (async () => {
        await bounceHcpAppointments();
        router.refresh();
      })();
    }
  }, [mirror, router]);

  // The actual trigger fire (no guard). Reused by onFire and by the OMW guard
  // modal once a prior open job is resolved.
  const runFire = async (triggerNumber: TriggerNum, fix?: { lat: number; lng: number; accuracyM: number | null }) => {
    setError(null);
    const res = await fireLifecycleTrigger({
      trigger_number: triggerNumber,
      hcp_job_id: hcpJobId,
      hcp_appointment_id: hcpAppointmentId ?? undefined,
      gps: fix,
      action_type: TRIGGER_ACTION[triggerNumber],
    });
    if (!res.ok) {
      setError(res.error);
      // Roll the optimistic on-site chip back to the stored truth.
      if (triggerNumber === 3) setStartedAt(startFiredAt ?? null);
      clearPressed(triggerNumber);
      return;
    }
    // Adopt the server's fired_at for the chip (was set optimistically on press).
    if (triggerNumber === 3) setStartedAt(res.fired_at);
    // Adopt it for the stage clock too — unless the server already had a row
    // (a mirror-retry re-fire must not reset an existing clock).
    if (!hasServerRow(triggerNumber)) setPressedAt((p) => ({ ...p, [triggerNumber]: res.fired_at }));
    setLastFired(triggerNumber);
    // "Build estimate" → open the 4-question builder for this job once the
    // trigger is logged (in-app route push, not a new tab; only on success).
    if (triggerNumber === 4) router.push(`/estimate/new?job=${hcpJobId}`);
    // Start tracking HCP mirror status if this trigger has one.
    if (HCP_MIRRORED_TRIGGERS.has(triggerNumber)) {
      setMirror((prev) => ({
        ...prev,
        [triggerNumber]: { firedAt: res.fired_at, status: { state: "pending" } },
      }));
    }
  };

  const onFire = (triggerNumber: TriggerNum) => {
    // "On my way" → launch turn-by-turn directions immediately so the tech can
    // drive while the HCP status mirrors in the background (Danny 2026-06-04:
    // OMW should pull up directions). Opened synchronously inside the click
    // gesture so mobile Safari doesn't block it; harmless no-op without an
    // address/coords. Decoupled from the (sometimes cold-starting) HCP bot.
    if (triggerNumber === 2 && directionsUrl && typeof window !== "undefined") {
      window.open(directionsUrl, "_blank", "noopener,noreferrer");
    }
    // Optimistic on-site chip: appears the instant Start is pressed (before the
    // GPS fix + server round-trip), so the press visibly "took". runFire adopts
    // the server timestamp on success and rolls back on failure.
    if (triggerNumber === 3 && !startedAt) setStartedAt(new Date().toISOString());
    // Optimistic stage clock for any first fire of a trigger (same rule as the
    // on-site chip: never reset an existing clock).
    if (!stageWindows.has(triggerNumber)) {
      setPressedAt((p) => ({ ...p, [triggerNumber]: new Date().toISOString() }));
    }
    setFiring(triggerNumber);
    startTransition(async () => {
      try {
        // Resolve a GPS fix and hand it to the server action, which persists the
        // per-action tech_locations row server-side (via after()). The old path
        // fired a client-side captureTechLocation whose POST raced (and lost) to
        // revalidate, landing 0 lifecycle rows (2026-06-17). A missing/denied fix
        // just skips the row — the trigger still fires.
        const fix = await resolveFix();

        // OMW guard: before On-My-Way, check for a prior job left open (started,
        // never Finished). If found, prompt Finish/Pause/Other and defer the fire.
        if (triggerNumber === 2) {
          const open = await getOpenJobForTech(hcpJobId);
          if (open) {
            setGuardJob(open);
            // A deferred OMW isn't a fire — no phantom clock while the guard
            // modal decides. onProceed's runFire(2) re-adopts on success.
            if (!hasServerRow(2)) clearPressed(2);
            return;
          }
        }
        await runFire(triggerNumber, fix);
      } finally {
        setFiring(null);
      }
    });
  };

  // Turn-by-turn deep link (not the paid Directions API) — launches the tech's
  // maps app (Google Maps app/web, or Apple Maps on iOS) straight to the job.
  const directionsUrl = (() => {
    const base = "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=";
    const addr = (destAddress ?? "").trim();
    if (addr) return base + encodeURIComponent(addr);
    if (typeof destLat === "number" && typeof destLng === "number" && !(destLat === 0 && destLng === 0)) {
      return base + encodeURIComponent(`${destLat},${destLng}`);
    }
    return null;
  })();

  // Soft "what's next" cue — the first un-fired step in normal order. Triggers
  // 3 and 4 are legitimately skippable, so this only de-emphasizes (never
  // disables) the off-path buttons and strengthens the call-to-action one.
  const nextTrigger = [2, 3, 4, 5, 6, 7].find((t) => !(firedTriggers.includes(t) || lastFired === t)) ?? 7;

  // On-site chip visibility: Start pressed, work not yet finished/done.
  const workEnded = [6, 7].some((t) => firedTriggers.includes(t) || lastFired === t);
  const showOnSite = !!startedAt && !workEnded;

  // Per-button stage windows (canonical time per trigger, press-preferred).
  const stageEvents: StageEvent[] = [
    ...(firedEvents ?? []),
    ...Object.entries(pressedAt).map(([n, at]) => ({
      trigger_number: Number(n), fired_at: at, origin: "dashboard" as string | null,
    })),
  ];
  const stageWindows = buildStageWindows(stageEvents, [2, 3, 4, 5, 6, 7]);
  const jobRunning = !workEnded;

  return (
    <div className="mt-2.5">
      {showOnSite ? (
        <div className="mb-1.5">
          <OnSiteElapsedChip startedAt={startedAt} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {directionsUrl ? (
          <a
            href={directionsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-teal-500 bg-teal-100 px-3 py-1.5 text-sm font-semibold text-teal-900 transition hover:bg-teal-200"
            title="Open turn-by-turn directions to the job site (also opens automatically when you tap On my way)"
          >
            🧭 Directions
          </a>
        ) : null}
        {BUTTONS.map((b) => {
          const wasFired = firedTriggers.includes(b.trigger) || lastFired === b.trigger;
          const st = stageWindows.get(b.trigger);
          const mirrorEntry = mirror[b.trigger];
          const baseClass =
            "min-h-11 inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition disabled:opacity-50";
          const isNext = !wasFired && b.trigger === nextTrigger;
          const variantClass = wasFired
            ? "border border-emerald-300 bg-emerald-50 text-emerald-800"
            : b.variant === "primary"
              ? "border border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
              : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50";
          // Soft emphasis: ring the expected next step, dim the off-path ones.
          const emphasisClass = wasFired
            ? ""
            : isNext
              ? " ring-2 ring-blue-400"
              : " opacity-60";
          return (
            <span key={b.trigger} className="inline-flex items-center gap-1">
              <button
                type="button"
                disabled={firing === b.trigger || wasFired}
                onClick={() => onFire(b.trigger)}
                className={`${baseClass} ${variantClass}${emphasisClass}`}
                title={st
                  ? `${b.label} — fired ${fmtPressTime(st.at)}${st.fired_by ? ` by ${st.fired_by}` : ""}`
                  : b.hint ?? b.label}
              >
                {firing === b.trigger ? "Sending…" : `${wasFired ? "✓ " : ""}${b.label}`}
                {/* Suffix gate mirrors TriggerForms' showClock: closed stage always,
                    open stage only while running — else the "·" would dangle on the
                    last-fired button of every completed job. */}
                {wasFired && st && firing !== b.trigger && (st.endedAt || jobRunning) ? (
                  <span className="ml-1.5 text-xs tabular-nums">
                    · <TriggerStageClock firedAt={st.at} endedAt={st.endedAt} live={jobRunning} />
                  </span>
                ) : null}
              </button>
              {mirrorEntry ? (
                <MirrorPill entry={mirrorEntry} hcpJobId={hcpJobId} onRetry={() => onFire(b.trigger)} retryDisabled={firing === b.trigger} />
              ) : null}
            </span>
          );
        })}
      </div>
      {firedTriggers.includes(5) || lastFired === 5 ? (
        ppSubmitted
          ? <div className="mt-1.5 text-[10px] font-medium text-emerald-700">✓ Post-presentation checklist on file</div>
          : <PostPresentationChecklist hcpJobId={hcpJobId} />
      ) : null}
      {firedTriggers.includes(7) || lastFired === 7 ? (
        eojSubmitted
          ? <div className="mt-1.5 text-[10px] font-medium text-emerald-700">✓ End-of-job checklist on file</div>
          : <EndOfJobChecklist hcpJobId={hcpJobId} />
      ) : null}
      {error ? <div className="mt-1 text-xs text-red-700">{error}</div> : null}
      {guardJob ? (
        <OmwGuardModal
          openJob={guardJob}
          onProceed={() => { setGuardJob(null); startTransition(async () => { await runFire(2); }); }}
          onCancel={() => setGuardJob(null)}
        />
      ) : null}
    </div>
  );
}

function MirrorPill({ entry, hcpJobId, onRetry, retryDisabled }: {
  entry: MirrorEntry;
  hcpJobId: string;
  onRetry: () => void;
  retryDisabled: boolean;
}) {
  const { status } = entry;
  if (status.state === "not_applicable") return null;
  if (status.state === "pending") {
    return (
      <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800" title="HCP mirror in progress (bot takes ~2:30)">
        🕒 HCP…
      </span>
    );
  }
  if (status.state === "synced") {
    return (
      <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800" title={`HCP mirror succeeded${status.elapsed_ms ? ` in ${(status.elapsed_ms / 1000).toFixed(1)}s` : ""}`}>
        ✓ HCP
      </span>
    );
  }
  if (status.state === "unconfirmed") {
    // Bot clicked Finish but HCP didn't expose a confirmation signal. Honest
    // amber — not a green ✓. verify_hcp_mirrors() reconciles against HCP.
    return (
      <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800" title={status.message ?? "Sent — HCP hasn't confirmed yet. It auto-reconciles against HCP work status; your press is already saved."}>
        🕒 HCP
      </span>
    );
  }
  if (status.state === "failed") {
    // Surface a short reason in the pill label when it matches a known blocker;
    // full error always available in tooltip + linked-out HCP fix path.
    const msg = (status.message ?? "").toLowerCase();
    const shortReason = msg.includes("checklist")
      ? "checklist"
      : msg.includes("invoice")
        ? "invoice"
        : msg.includes("auth")
          ? "auth"
          : null;
    const label = shortReason ? `⚠ HCP: ${shortReason}` : "⚠ HCP";
    const hcpUrl = `https://pro.housecallpro.com/app/jobs/${hcpJobId}`;
    return (
      <span className="inline-flex items-center gap-1">
        <a
          href={hcpUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-800 hover:bg-red-100"
          title={`${status.message ?? "HCP mirror failed"} · Click to open job in HCP`}
        >
          {label}
        </a>
        <button
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
          className="rounded-md border border-neutral-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          title="Re-fire after fixing in HCP"
        >
          ↻
        </button>
      </span>
    );
  }
  return (
    <span className="rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] text-neutral-600" title={status.message ?? "Status unknown"}>
      ?
    </span>
  );
}
