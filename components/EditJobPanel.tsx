"use client";

// Edit-job panel on the job page (#33). The job-360 page was view-only — no way
// to change a job's date/time or tech, which made "create a job then edit it"
// dead-end on the create flow. This adds a deliberate, MGMT-gated editor that
// writes through editJobSchedule -> update-hcp-job PATCH (same path as the
// /schedule apply-worker + /dispatch reassign), then refreshes.
//
// Visibility != notification: changing the scheduled time MAY make HCP notify
// the customer, so the reschedule path confirms before writing.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editJobSchedule } from "../lib/schedule-changes";

export function EditJobPanel({
  hcpJobId,
  currentDate,
  currentTime,
  currentTechFull,
  techs,
}: {
  hcpJobId: string;
  currentDate: string | null; // YYYY-MM-DD (Chicago)
  currentTime: string | null; // HH:MM (Chicago)
  currentTechFull: string | null;
  techs: Array<{ full: string; short: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const [date, setDate] = useState(currentDate ?? "");
  const [time, setTime] = useState(currentTime ?? "");
  const [tech, setTech] = useState(currentTechFull ?? "");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setOk(false); setErr(null); }}
        className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
      >
        ✎ Edit schedule / tech
      </button>
    );
  }

  const dateChanged = date && date !== (currentDate ?? "");
  const timeChanged = time && time !== (currentTime ?? "");
  const techChanged = tech && tech !== (currentTechFull ?? "");
  const scheduleChanged = dateChanged || timeChanged;
  const nothingChanged = !scheduleChanged && !techChanged;

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-neutral-800">Edit job</h4>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-400 hover:underline">close</button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={pending}
            className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">Start time</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={pending}
            className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">Assigned tech</span>
          <select
            value={tech}
            onChange={(e) => setTech(e.target.value)}
            disabled={pending}
            className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          >
            <option value="">{currentTechFull ?? "Unassigned"}</option>
            {techs.filter((t) => t.full !== currentTechFull).map((t) => (
              <option key={t.full} value={t.full}>{t.short}</option>
            ))}
          </select>
        </label>
      </div>

      {scheduleChanged ? (
        <p className="mt-2 text-[11px] text-amber-700">
          Changing the date/time updates the real HCP job — HCP may text the customer about the new time.
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending || nothingChanged}
          onClick={() => {
            if (scheduleChanged && !window.confirm(`Update this job's schedule on HCP?\n\nThe customer may be notified of the new time.`)) return;
            start(async () => {
              const r = await editJobSchedule({
                hcp_job_id: hcpJobId,
                date: dateChanged ? date : null,
                time: scheduleChanged ? (time || currentTime) : null,
                tech_full_name: techChanged ? tech : null,
              });
              if (!r.ok) { setErr(r.error ?? "failed"); setOk(false); return; }
              setErr(null);
              setOk(true);
              router.refresh();
            });
          }}
          className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save to HCP"}
        </button>
        {nothingChanged ? <span className="text-[11px] text-neutral-400">Change a field to enable</span> : null}
        {ok ? <span className="text-xs text-green-700">✓ Updated — syncing…</span> : null}
        {err ? <span className="text-xs text-red-600">{err}</span> : null}
      </div>
    </div>
  );
}
