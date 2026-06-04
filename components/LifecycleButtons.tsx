"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fireLifecycleTrigger, getLifecycleHcpStatus, type HcpMirrorStatus } from "@/app/me/lifecycle-actions";
import { captureTechLocation } from "@/lib/capture-tech-location";
import { bounceHcpAppointments } from "@/lib/bounce-hcp-appointments";
import { getOpenJobForTech, type OpenJob } from "@/lib/omw-guard-actions";
import { OmwGuardModal } from "./OmwGuardModal";
import { PostPresentationChecklist } from "./PostPresentationChecklist";
import { EndOfJobChecklist } from "./EndOfJobChecklist";

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
};

type TriggerNum = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const BUTTONS: Array<{
  trigger: TriggerNum;
  label: string;
  variant: "primary" | "secondary" | "danger";
}> = [
  { trigger: 2, label: "On my way", variant: "secondary" },
  { trigger: 3, label: "Start", variant: "secondary" },
  { trigger: 4, label: "Build estimate", variant: "secondary" },
  { trigger: 5, label: "Present", variant: "secondary" },
  { trigger: 6, label: "Finish work", variant: "secondary" },
  { trigger: 7, label: "Done", variant: "primary" },
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

type MirrorEntry = { firedAt: string; status: HcpMirrorStatus };

export function LifecycleButtons({ hcpJobId, hcpAppointmentId, firedTriggers, initialMirrors, destAddress, destLat, destLng, ppSubmitted, eojSubmitted }: Props) {
  const [pending, startTransition] = useTransition();
  const [lastFired, setLastFired] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          updates[t] = { firedAt: entry.firedAt, status: { state: "failed", message: "Timed out waiting for HCP sync log (>5 min)" } };
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
  const runFire = async (triggerNumber: TriggerNum) => {
    setError(null);
    const res = await fireLifecycleTrigger({
      trigger_number: triggerNumber,
      hcp_job_id: hcpJobId,
      hcp_appointment_id: hcpAppointmentId ?? undefined,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLastFired(triggerNumber);
    // Start tracking HCP mirror status if this trigger has one.
    if (HCP_MIRRORED_TRIGGERS.has(triggerNumber)) {
      setMirror((prev) => ({
        ...prev,
        [triggerNumber]: { firedAt: res.fired_at, status: { state: "pending" } },
      }));
    }
  };

  const onFire = (triggerNumber: TriggerNum) => {
    // Universal location ping for the per-action audit + dispatch map
    // (fire-and-forget). Pairs the button press with the tech's GPS.
    captureTechLocation(TRIGGER_ACTION[triggerNumber], { hcpJobId });
    // "On my way" → launch turn-by-turn directions immediately so the tech can
    // drive while the HCP status mirrors in the background (Danny 2026-06-04:
    // OMW should pull up directions). Opened synchronously inside the click
    // gesture so mobile Safari doesn't block it; harmless no-op without an
    // address/coords. Decoupled from the (sometimes cold-starting) HCP bot.
    if (triggerNumber === 2 && directionsUrl && typeof window !== "undefined") {
      window.open(directionsUrl, "_blank", "noopener,noreferrer");
    }
    startTransition(async () => {
      // OMW guard: before On-My-Way, check for a prior job left open (started,
      // never Finished). If found, prompt Finish/Pause/Other and defer the fire.
      if (triggerNumber === 2) {
        const open = await getOpenJobForTech(hcpJobId);
        if (open) { setGuardJob(open); return; }
      }
      await runFire(triggerNumber);
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

  return (
    <div className="mt-2.5">
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
          const mirrorEntry = mirror[b.trigger];
          const baseClass =
            "rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50";
          const variantClass = wasFired
            ? "border border-emerald-300 bg-emerald-50 text-emerald-800"
            : b.variant === "primary"
              ? "border border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
              : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50";
          return (
            <span key={b.trigger} className="inline-flex items-center gap-1">
              <button
                type="button"
                disabled={pending}
                onClick={() => onFire(b.trigger)}
                className={`${baseClass} ${variantClass}`}
                title={`Fire trigger ${b.trigger}`}
              >
                {wasFired ? "✓ " : ""}{b.label}
              </button>
              {mirrorEntry ? (
                <MirrorPill entry={mirrorEntry} hcpJobId={hcpJobId} onRetry={() => onFire(b.trigger)} retryDisabled={pending} />
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
      <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800" title={status.message ?? "Finish sent — HCP hasn't confirmed yet. Auto-reconciles against HCP work status."}>
        HCP ?
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
