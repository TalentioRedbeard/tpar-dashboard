"use client";

import { useState, useTransition } from "react";
import { createAlarm, type CreateAlarmInput } from "@/app/alarms/actions";

const TIERS: Array<{ value: CreateAlarmInput["requirement_level"]; label: string; hint: string }> = [
  { value: "soft",     label: "Soft",     hint: "Pushover normal only" },
  { value: "medium",   label: "Medium",   hint: "Pushover + Twilio call (no auth)" },
  { value: "hard",     label: "Hard",     hint: "Twilio call with 1-digit auth" },
  { value: "critical", label: "Critical", hint: "Twilio + Pushover emergency, 3-digit auth" },
  { value: "extreme",  label: "Extreme",  hint: "Critical + SMS to backup contacts after 3 attempts" },
];

export function AlarmCreateForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [fireAt, setFireAt] = useState(() => {
    // default: 7:00 AM the next day, in Chicago wall-clock time
    const now = new Date();
    const chicago = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const tomorrow = new Date(chicago);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(7, 0, 0, 0);
    return tomorrow.toISOString().slice(0, 16);
  });
  const [tier, setTier] = useState<CreateAlarmInput["requirement_level"]>("critical");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
      >
        + Schedule alarm
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-brand-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">Schedule new alarm</h3>
        <button
          type="button"
          onClick={() => { setOpen(false); setResult(null); }}
          className="text-xs text-neutral-500 hover:text-neutral-700"
        >
          Close
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-neutral-700">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sunday Claremore wake-up"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            maxLength={120}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700">Fire at (Chicago time)</label>
          <input
            type="datetime-local"
            value={fireAt}
            onChange={(e) => setFireAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-neutral-700">Tier</label>
          <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-5">
            {TIERS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTier(t.value)}
                className={
                  "rounded-md border px-2 py-1.5 text-left text-xs " +
                  (tier === t.value
                    ? "border-brand-500 bg-brand-50 ring-1 ring-inset ring-brand-300"
                    : "border-neutral-200 bg-white hover:border-neutral-300")
                }
              >
                <div className={"font-medium " + (tier === t.value ? "text-brand-900" : "text-neutral-900")}>
                  {t.label}
                </div>
                <div className="text-[10px] leading-tight text-neutral-500">{t.hint}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={pending || !name.trim() || !fireAt}
          onClick={() => {
            setResult(null);
            startTransition(async () => {
              const r = await createAlarm({ name: name.trim(), fire_at_local: fireAt, requirement_level: tier });
              if (r.ok) {
                setResult({ kind: "ok", msg: `Scheduled · alarm id ${r.alarm_id.slice(0, 8)}…` });
                setName("");
              } else {
                setResult({ kind: "err", msg: r.error });
              }
            });
          }}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:bg-brand-300"
        >
          {pending ? "Scheduling…" : "Schedule"}
        </button>
        {result && (
          <span className={"text-xs " + (result.kind === "ok" ? "text-emerald-700" : "text-red-700")}>
            {result.msg}
          </span>
        )}
      </div>
    </div>
  );
}
