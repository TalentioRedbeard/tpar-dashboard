"use client";

// "Fired so far" timeline for /job/[id]. Read-only for everyone; managers|admins
// (canEditTimes) get an inline "edit time" affordance on each row to correct a
// trigger's press time (pressed late, on the wrong clock, forgotten till later).
// An edited time is stamped irreversibly — the row shows "✎ edited by <name>"
// forever, and the original press time survives in the tooltip. Stage-duration
// views recompute off fired_at, so the correction moves the clocks to match.
// (Danny 2026-07-21.)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editTriggerFiredAt, type FiredTrigger } from "./trigger-actions";
import { ScrollPanel } from "../../../components/ui/ScrollPanel";

const TZ = "America/Chicago";

// ISO instant → "YYYY-MM-DDTHH:MM" as Chicago wall-clock, for a datetime-local input.
function isoToChicagoLocal(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hh = String(Number(g("hour")) % 24).padStart(2, "0"); // some engines emit "24" at midnight
  return `${g("year")}-${g("month")}-${g("day")}T${hh}:${g("minute")}`;
}

// Chicago wall-clock "YYYY-MM-DDTHH:MM" → UTC ISO instant (DST-correct, no lib).
function chicagoLocalToISO(wall: string): string {
  const [d, t] = wall.split("T");
  const [Y, M, D] = d.split("-").map(Number);
  const [h, m] = t.split(":").map(Number);
  const guess = Date.UTC(Y, M - 1, D, h, m);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(guess));
  const g = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asZoned = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  const offset = asZoned - guess; // how far Chicago is ahead of UTC at this instant
  return new Date(guess - offset).toISOString();
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
}

export function FiredTriggersList({
  firedTriggers, hcpJobId, canEditTimes,
}: {
  firedTriggers: FiredTrigger[];
  hcpJobId: string;
  canEditTimes: boolean;
}) {
  if (firedTriggers.length === 0) return null;
  return (
    <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">Fired so far</div>
      <ScrollPanel tier="standard">
        <ul className="space-y-1 text-xs text-neutral-700">
          {firedTriggers.map((t) => (
            <FiredRow key={t.id} t={t} hcpJobId={hcpJobId} canEditTimes={canEditTimes} />
          ))}
        </ul>
      </ScrollPanel>
    </div>
  );
}

function FiredRow({ t, hcpJobId, canEditTimes }: { t: FiredTrigger; hcpJobId: string; canEditTimes: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const edited = !!t.fired_at_edited_by;

  const open = () => { setValue(isoToChicagoLocal(t.fired_at)); setError(null); setEditing(true); };
  const save = () => {
    setError(null);
    if (!value) { setError("Pick a time."); return; }
    const iso = chicagoLocalToISO(value);
    start(async () => {
      const res = await editTriggerFiredAt({ event_id: t.id, hcp_job_id: hcpJobId, new_fired_at: iso });
      if (!res.ok) { setError(res.error); return; }
      setEditing(false);
      router.refresh();
    });
  };

  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="font-mono">#{t.trigger_number}</span>
      <span className="font-medium">{t.trigger_name}</span>
      <span className="text-neutral-500">·</span>
      {t.origin === "hcp_derived" ? (
        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700" title="Derived from HCP work timestamps — not an in-app press">from HCP</span>
      ) : (
        <span>{t.fired_by ?? "—"}</span>
      )}
      <span className="text-neutral-400">·</span>

      {editing ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button type="button" onClick={save} disabled={pending} className="rounded bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} disabled={pending} className="text-[11px] text-neutral-500 hover:text-neutral-800">cancel</button>
          {error ? <span className="text-[11px] text-red-700">{error}</span> : null}
        </span>
      ) : (
        <>
          <span className="text-neutral-500" title={edited && t.fired_at_original ? `Originally ${fmt(t.fired_at_original)}` : undefined}>
            {fmt(t.fired_at)}
          </span>
          {edited ? (
            <span className="text-[10px] italic text-amber-700" title={t.fired_at_edited_at ? `Edited ${fmt(t.fired_at_edited_at)}` : undefined}>
              ✎ edited by {t.fired_at_edited_by}
            </span>
          ) : null}
          {canEditTimes ? (
            <button type="button" onClick={open} className="text-[11px] text-neutral-400 hover:text-brand-700" title="Edit the time this trigger was pressed">
              ✎ edit time
            </button>
          ) : null}
        </>
      )}
    </li>
  );
}
