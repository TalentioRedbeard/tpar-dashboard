"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { fireLifecycleTrigger, getLifecycleHcpStatus, type HcpMirrorStatus } from "@/app/me/lifecycle-actions";

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
    state: "pending" | "synced" | "failed";
    message?: string;
    elapsed_ms?: number;
  }>;
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

type MirrorEntry = { firedAt: string; status: HcpMirrorStatus };

export function LifecycleButtons({ hcpJobId, hcpAppointmentId, firedTriggers, initialMirrors }: Props) {
  const [pending, startTransition] = useTransition();
  const [lastFired, setLastFired] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const onFire = (triggerNumber: TriggerNum) => {
    startTransition(async () => {
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
    });
  };

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap gap-1.5">
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
      {error ? <div className="mt-1 text-xs text-red-700">{error}</div> : null}
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
