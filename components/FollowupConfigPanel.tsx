"use client";

// Owner-only control panel for the Phase 3 estimate follow-up engine. Reads/writes the
// followup_engine_config singleton via the owner-gated updateFollowupConfig action.
// Helper inputs are MODULE-LEVEL (not inner components) so number inputs don't lose focus
// on each keystroke.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateFollowupConfig, type FollowupConfig } from "@/app/dispatch/followup-actions";

function CfgToggle({ on, label, danger, disabled, onClick }: {
  on: boolean; label: string; danger?: boolean; disabled: boolean; onClick: () => void;
}) {
  const cls = on
    ? (danger ? "border-amber-400 bg-amber-50 text-amber-800" : "border-emerald-400 bg-emerald-50 text-emerald-800")
    : "border-neutral-300 bg-neutral-100 text-neutral-500";
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`rounded-md border px-2 py-1 text-xs font-medium ${cls}`}>
      {on ? "● " : "○ "}{label}
    </button>
  );
}

function CfgNum({ value, label, disabled, onChange }: {
  value: number; label: string; disabled: boolean; onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-neutral-700">
      {label}
      <input type="number" value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) | 0)}
        className="w-14 rounded border border-neutral-300 px-1.5 py-0.5 text-xs" />
    </label>
  );
}

export function FollowupConfigPanel({ config }: { config: FollowupConfig | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [c, setC] = useState<FollowupConfig | null>(config);

  if (!c) {
    return (
      <div className="rounded-2xl border border-neutral-200 border-t-[3px] border-t-slate-400 bg-white p-4 text-sm text-neutral-500">
        Follow-up engine config unavailable.
      </div>
    );
  }
  const cfg = c; // non-null alias for the closures below

  function set<K extends keyof FollowupConfig>(k: K, v: FollowupConfig[K]) {
    setSaved(false);
    setC((prev) => (prev ? { ...prev, [k]: v } : prev));
  }

  function save() {
    setErr(null);
    setSaved(false);
    start(async () => {
      const r = await updateFollowupConfig({
        enabled: cfg.enabled, auto_send: cfg.auto_send,
        first_nudge_days: cfg.first_nudge_days, quiet_days: cfg.quiet_days, reping_days: cfg.reping_days,
        expiry_lead_days: cfg.expiry_lead_days, max_nudges: cfg.max_nudges,
        email_never_viewed: cfg.email_never_viewed, email_viewed_quiet: cfg.email_viewed_quiet,
        business_hour_start: cfg.business_hour_start, business_hour_end: cfg.business_hour_end,
      });
      if (r.ok) { setSaved(true); router.refresh(); } else setErr(r.error);
    });
  }

  return (
    <div className={`rounded-2xl border bg-white p-4 ${cfg.enabled ? "border-neutral-200 border-t-[3px] border-t-slate-400" : "border-red-300 border-t-[3px] border-t-red-500"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-neutral-900">📨 Estimate follow-up engine</h3>
        {!cfg.enabled ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">PAUSED</span> : null}
        {cfg.auto_send
          ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">AUTO-SEND</span>
          : <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">approval queue</span>}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <CfgToggle on={cfg.enabled} disabled={pending} label={cfg.enabled ? "Engine ON" : "Engine OFF"} onClick={() => set("enabled", !cfg.enabled)} />
        <CfgToggle on={cfg.auto_send} disabled={pending} danger label="Auto-send (skip approval)" onClick={() => set("auto_send", !cfg.auto_send)} />
        <CfgToggle on={cfg.email_never_viewed} disabled={pending} label="Email never-viewed" onClick={() => set("email_never_viewed", !cfg.email_never_viewed)} />
        <CfgToggle on={cfg.email_viewed_quiet} disabled={pending} label="Email viewed-quiet" onClick={() => set("email_viewed_quiet", !cfg.email_viewed_quiet)} />
      </div>
      <div className="mb-3 flex flex-wrap gap-3">
        <CfgNum value={cfg.first_nudge_days} disabled={pending} label="first nudge (d)" onChange={(n) => set("first_nudge_days", n)} />
        <CfgNum value={cfg.quiet_days} disabled={pending} label="viewed-quiet (d)" onChange={(n) => set("quiet_days", n)} />
        <CfgNum value={cfg.reping_days} disabled={pending} label="re-ping gap (d)" onChange={(n) => set("reping_days", n)} />
        <CfgNum value={cfg.expiry_lead_days} disabled={pending} label="expiry lead (d)" onChange={(n) => set("expiry_lead_days", n)} />
        <CfgNum value={cfg.max_nudges} disabled={pending} label="max nudges" onChange={(n) => set("max_nudges", n)} />
        <CfgNum value={cfg.business_hour_start} disabled={pending} label="hours start" onChange={(n) => set("business_hour_start", n)} />
        <CfgNum value={cfg.business_hour_end} disabled={pending} label="hours end" onChange={(n) => set("business_hour_end", n)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={save} className="rounded-md bg-brand-700 px-3 py-1 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{pending ? "Saving…" : "Apply"}</button>
        {saved ? <span className="text-xs text-emerald-700">Saved ✓</span> : null}
        {err ? <span className="text-xs text-red-700">{err}</span> : null}
        {cfg.updated_by ? <span className="text-[10px] text-neutral-400">last by {cfg.updated_by}</span> : null}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-neutral-500">
        <b>Auto-send</b> ON emails customers without the approval step — leave it off until the targeting is trusted. <b>Engine OFF</b> is the global kill-switch. Cadence changes apply on the next daily sweep (9am CT weekdays).
      </p>
    </div>
  );
}
