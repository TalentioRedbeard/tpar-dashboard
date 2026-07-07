"use client";

// /owner control-panel interactive pieces (client). All write paths call the
// owner-gated server actions in app/owner/owner-actions.ts; the server re-checks
// requireOwner() so these controls are UX only, never the security boundary.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addImprovementNote,
  setImprovementNoteStatus,
  approveDoctrine,
  retireDoctrine,
  toggleAppFlag,
} from "@/app/owner/owner-actions";

// ── Add improvement note ─────────────────────────────────────────────────────
export function AddImprovementNoteForm() {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [area, setArea] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    const text = note.trim();
    if (!text) return;
    start(async () => {
      const r = await addImprovementNote({ note: text, area: area.trim() || null });
      if (r.ok) {
        setNote("");
        setArea("");
        router.refresh();
      } else {
        setErr(r.error);
      }
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={area}
          onChange={(e) => setArea(e.target.value)}
          placeholder="area (e.g. estimates)"
          disabled={pending}
          className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm sm:w-40"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder="＋ add improvement note — what needs to change?"
          disabled={pending}
          className="w-full flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={submit}
          disabled={pending || !note.trim()}
          className="whitespace-nowrap rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {err ? <p className="mt-1 text-xs text-red-700">{err}</p> : null}
    </div>
  );
}

// ── Improvement-note row controls (mark doing / done / drop) ──────────────────
export function ImprovementNoteControls({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function set(status: "doing" | "done" | "dropped") {
    setErr(null);
    start(async () => {
      const r = await setImprovementNoteStatus(id, status);
      if (r.ok) router.refresh();
      else setErr(r.error);
    });
  }

  return (
    <div className="flex items-center gap-1">
      <button type="button" disabled={pending} onClick={() => set("doing")}
        className="rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50">
        Doing
      </button>
      <button type="button" disabled={pending} onClick={() => set("done")}
        className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
        Done
      </button>
      <button type="button" disabled={pending} onClick={() => set("dropped")}
        className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600 hover:bg-neutral-200 disabled:opacity-50">
        Drop
      </button>
      {err ? <span className="text-[10px] text-red-700">{err}</span> : null}
    </div>
  );
}

// ── Field-doctrine review row (approve / keep hidden) ─────────────────────────
export function DoctrineReviewControls({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function act(kind: "approve" | "retire") {
    setErr(null);
    start(async () => {
      const r = kind === "approve" ? await approveDoctrine(id) : await retireDoctrine(id);
      if (r.ok) router.refresh();
      else setErr(r.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" disabled={pending} onClick={() => act("approve")}
        className="rounded-md border border-emerald-400 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
        ✓ Approve
      </button>
      <button type="button" disabled={pending} onClick={() => act("retire")}
        className="rounded-md border border-neutral-300 bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-200 disabled:opacity-50">
        Keep hidden
      </button>
      {err ? <span className="text-[10px] text-red-700">{err}</span> : null}
    </div>
  );
}

// ── App-flag toggle ───────────────────────────────────────────────────────────
export function AppFlagToggle({ flagKey, enabled }: { flagKey: string; enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(enabled);
  const [err, setErr] = useState<string | null>(null);

  function toggle() {
    setErr(null);
    const next = !on;
    start(async () => {
      const r = await toggleAppFlag(flagKey, next);
      if (r.ok) { setOn(next); router.refresh(); }
      else setErr(r.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" disabled={pending} onClick={toggle}
        className={`rounded-md border px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
          on
            ? "border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
            : "border-neutral-300 bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
        }`}>
        {on ? "● ON" : "○ OFF"}
      </button>
      {err ? <span className="text-[10px] text-red-700">{err}</span> : null}
    </div>
  );
}
