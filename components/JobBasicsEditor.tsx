"use client";

// 🖍️ Edit job (schedule + assigned tech) — admin/management only (Danny 2026-07-21,
// Q1). A typed alternative to the /schedule drag: reschedule the date/time and/or
// reassign the tech, write-through to HCP (update-hcp-job). Duration is preserved.
// Customer is not auto-texted. Tech role never sees this (page gates on render).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editJobBasics, type AssignableTech } from "../app/job/[id]/job-edit-actions";

const TZ = "America/Chicago";

// ISO instant → "YYYY-MM-DDTHH:MM" Chicago wall-clock (for datetime-local).
function isoToChicagoLocal(iso: string): string {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const hh = String(Number(g("hour")) % 24).padStart(2, "0");
  return `${g("year")}-${g("month")}-${g("day")}T${hh}:${g("minute")}`;
}
// Chicago wall-clock "YYYY-MM-DDTHH:MM" → UTC ISO (DST-correct, no lib).
function chicagoLocalToISO(wall: string): string {
  const [d, t] = wall.split("T");
  const [Y, M, D] = d.split("-").map(Number);
  const [h, m] = t.split(":").map(Number);
  const guess = Date.UTC(Y, M - 1, D, h, m);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(guess));
  const g = (type: string) => Number(p.find((x) => x.type === type)?.value);
  const asZoned = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return new Date(guess - (asZoned - guess)).toISOString();
}

export type JobBasicsInitial = {
  scheduledStartIso: string | null;
  durationMin: number;
  currentTechName: string | null;
};

const inputCls = "w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";
const lblCls = "block text-[11px] font-medium uppercase tracking-wide text-neutral-500 mb-1";

export function JobBasicsEditor({ hcpJobId, initial, techs }: { hcpJobId: string; initial: JobBasicsInitial; techs: AssignableTech[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const initLocal = initial.scheduledStartIso ? isoToChicagoLocal(initial.scheduledStartIso) : "";
  const [when, setWhen] = useState(initLocal);
  const [techId, setTechId] = useState(""); // "" = keep current

  const openModal = () => { setWhen(initLocal); setTechId(""); setErr(null); setOpen(true); };

  function save() {
    setErr(null);
    const payload: Parameters<typeof editJobBasics>[0] = { hcp_job_id: hcpJobId };
    if (when && when !== initLocal) {
      const startIso = chicagoLocalToISO(when);
      payload.scheduled_start = startIso;
      payload.scheduled_end = new Date(new Date(startIso).getTime() + Math.max(15, initial.durationMin) * 60_000).toISOString();
    }
    if (techId) payload.assigned_employee_id = techId;
    if (!payload.scheduled_start && !payload.assigned_employee_id) { setOpen(false); return; }
    start(async () => {
      const res = await editJobBasics(payload);
      if (!res.ok) { setErr(res.error ?? "Couldn't save."); return; }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Edit the job's schedule or assigned tech"
        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
      >
        🖍️ Edit job
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => !pending && setOpen(false)}>
          <div className="mt-10 w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">Edit job</h3>
              <button type="button" onClick={() => !pending && setOpen(false)} className="text-xs text-neutral-500 hover:text-neutral-800">close ×</button>
            </div>
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
              Reschedule + reassign <span className="font-semibold">write through to Housecall Pro</span> (same as dragging on the schedule). Duration is kept; the customer is not texted.
            </p>

            <div className="space-y-3">
              <div>
                <label className={lblCls}>Date &amp; time</label>
                <input type="datetime-local" className={inputCls} value={when} disabled={pending} onChange={(e) => setWhen(e.target.value)} />
                <p className="mt-1 text-[10px] text-neutral-400">Keeps the current {Math.max(15, initial.durationMin)}-min length.</p>
              </div>
              <div>
                <label className={lblCls}>Assigned tech</label>
                <select className={inputCls} value={techId} disabled={pending} onChange={(e) => setTechId(e.target.value)}>
                  <option value="">Keep current{initial.currentTechName ? ` — ${initial.currentTechName}` : ""}</option>
                  {techs.map((t) => (
                    <option key={t.hcp_employee_id} value={t.hcp_employee_id}>{t.tech_short_name} — {t.hcp_full_name}</option>
                  ))}
                </select>
              </div>
            </div>

            <p className="mt-3 text-[10px] text-neutral-400">Job notes live in Housecall Pro as timestamped entries — editing those is coming separately.</p>
            {err ? <div className="mt-2 text-xs text-red-700">{err}</div> : null}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={() => !pending && setOpen(false)} disabled={pending} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:text-neutral-900">Cancel</button>
              <button type="button" onClick={save} disabled={pending} className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                {pending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
