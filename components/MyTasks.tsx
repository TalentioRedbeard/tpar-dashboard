"use client";

// Tech-facing task list (#18, Danny 2026-05-31). A tech sees tasks assigned to
// them and marks "I've got it" (accept) or "Can't do" (with a reason → flags
// Danny + records the missing skill on the task). Once accepted, they can mark
// it Done. The other side (assign / see responses) lives in the dispatch TaskList.
//
// Task System v1 (2026-06-24): adds a "Blocked" action — a small modal with the
// blocker taxonomy (Part / Info / Skill &/or Help / Access / Customer / Other) +
// a note → markBlocked. A blocked task shows the child requirement tasks the tech
// is waiting on, and surfaces in-line when it has been unblocked.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToTask, setTaskStatus, markBlocked } from "../lib/tasks";
import { BLOCKER_TYPES, isBlockerReq, type Task, type BlockerType } from "../lib/task-types";
import { ScrollPanel } from "./ui/ScrollPanel";

// Children of a tech's blocked tasks, keyed by parent_task_id, so the tech can
// see the requirement(s) being worked to unblock them.
export type MyTaskChildren = Record<string, Pick<Task, "id" | "title" | "status" | "assigned_to" | "assigned_role">[]>;

export function MyTasks({ tasks, childrenByParent }: { tasks: Task[]; childrenByParent?: MyTaskChildren }) {
  if (tasks.length === 0) return null;
  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/40 p-4">
      <h3 className="mb-2 text-sm font-semibold text-sky-900">📋 Tasks for you · {tasks.length}</h3>
      <ScrollPanel tier="standard"><ul className="space-y-2">{tasks.map((t) => <MyTaskRow key={t.id} task={t} children={childrenByParent?.[t.id] ?? []} />)}</ul></ScrollPanel>
    </div>
  );
}

function MyTaskRow({ task, children }: { task: Task; children: Pick<Task, "id" | "title" | "status" | "assigned_to" | "assigned_role">[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockTypes, setBlockTypes] = useState<BlockerType[]>([]);
  const [blockNote, setBlockNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setErr(null);
    start(async () => { const r = await fn(); if (!r.ok) setErr(r.error ?? "failed"); else router.refresh(); });
  }

  function toggleType(t: BlockerType) {
    setBlockTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  const responded = task.tech_response;
  const isBlocked = task.status === "blocked";
  const openChildren = children.filter((c) => c.status !== "done" && c.status !== "canceled");
  // A blocker requirement is the most recent {kind:'blocker'} row, if any.
  const blockerReq = [...task.requirements].reverse().find(isBlockerReq);

  return (
    <li className={`rounded-xl border p-2.5 ${isBlocked ? "border-orange-300 bg-orange-50" : "border-sky-200 bg-white"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-neutral-900">{task.title}</span>
        {isBlocked ? <span className="rounded bg-orange-200 px-1.5 py-0.5 text-[10px] font-medium text-orange-900">🚧 blocked</span> : null}
        {!isBlocked && responded === "accepted" ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">✓ accepted</span> : null}
        {responded === "declined" ? <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-800">can&apos;t do</span> : null}
        <span className="ml-auto flex items-center gap-1.5">
          {isBlocked ? (
            // Blocked but no open requirement tasks yet → let the tech pick it back up.
            openChildren.length === 0 ? (
              <button type="button" disabled={pending} onClick={() => run(() => setTaskStatus(task.id, "in_progress"))} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">Resume</button>
            ) : null
          ) : !responded ? (
            <>
              <button type="button" disabled={pending} onClick={() => run(() => respondToTask(task.id, "accepted"))} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">I&apos;ve got it</button>
              <button type="button" disabled={pending} onClick={() => setBlockOpen((o) => !o)} className="rounded border border-orange-300 bg-orange-50 px-2 py-0.5 text-xs text-orange-800 hover:bg-orange-100">Blocked</button>
              <button type="button" disabled={pending} onClick={() => setDeclineOpen((o) => !o)} className="rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs text-rose-800 hover:bg-rose-100">Can&apos;t do</button>
            </>
          ) : responded === "accepted" ? (
            <>
              <button type="button" disabled={pending} onClick={() => setBlockOpen((o) => !o)} className="rounded border border-orange-300 bg-orange-50 px-2 py-0.5 text-xs text-orange-800 hover:bg-orange-100">Blocked</button>
              <button type="button" disabled={pending} onClick={() => run(() => setTaskStatus(task.id, "done"))} className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-50">✓ Done</button>
            </>
          ) : null}
        </span>
      </div>
      {task.detail ? <div className="mt-1 text-xs text-neutral-600">{task.detail}</div> : null}

      {/* Non-blocker requirements (free-text requirement/skill chips). */}
      {task.requirements.some((r) => !isBlockerReq(r)) ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.requirements.map((r, i) => isBlockerReq(r) ? null : (
            <span key={i} className={`rounded px-1.5 py-0.5 text-[10px] ${r.kind === "skill" ? "bg-violet-100 text-violet-800" : "bg-neutral-200 text-neutral-700"}`}>{r.kind === "skill" ? "🛠 " : "• "}{r.text}</span>
          ))}
        </div>
      ) : null}

      {/* What the tech is waiting on (the spawned requirement tasks). */}
      {isBlocked ? (
        <div className="mt-1.5 rounded-lg border border-orange-200 bg-white/70 p-2">
          {blockerReq ? (
            <div className="mb-1 text-[11px] text-orange-900">
              Needs: {blockerReq.types.map((t) => BLOCKER_TYPES.find((b) => b.value === t)?.label ?? t).join(", ")}
              {blockerReq.note ? <span className="italic"> — “{blockerReq.note}”</span> : null}
            </div>
          ) : null}
          {openChildren.length > 0 ? (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-orange-700">Waiting on</div>
              <ul className="mt-0.5 space-y-0.5">
                {openChildren.map((c) => (
                  <li key={c.id} className="flex items-center gap-1.5 text-[11px] text-orange-900">
                    <span className="rounded bg-orange-100 px-1 py-0.5 text-[9px] uppercase">{c.status === "in_progress" ? "in progress" : c.status}</span>
                    <span>{c.title}</span>
                    <span className="text-orange-700/70">{c.assigned_to ? `· ${c.assigned_to}` : c.assigned_role ? `· ${c.assigned_role}` : "· unassigned"}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="text-[11px] text-orange-800">No requirement tasks yet — a manager will route this. You can Resume once it&apos;s cleared.</div>
          )}
        </div>
      ) : null}

      {responded === "declined" && task.tech_response_note ? <div className="mt-1 text-xs italic text-rose-700">“{task.tech_response_note}”</div> : null}

      {/* Decline (can't do) inline form. */}
      {declineOpen && !responded && !isBlocked ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What's missing? (skill, tool, info) — goes to Danny" className="flex-1 rounded-md border border-rose-300 px-2 py-0.5 text-xs" />
          <button type="button" disabled={pending || !reason.trim()} onClick={() => run(async () => { const r = await respondToTask(task.id, "declined", reason); if (r.ok) { setReason(""); setDeclineOpen(false); } return r; })} className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-rose-700 disabled:opacity-50">Send</button>
        </div>
      ) : null}

      {/* Blocked modal — multi-select taxonomy + note. */}
      {blockOpen && !isBlocked ? (
        <div className="mt-1.5 rounded-lg border border-orange-300 bg-orange-50 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-orange-800">I&apos;m blocked — what do you need?</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {BLOCKER_TYPES.map((b) => (
              <label key={b.value} className={`flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${blockTypes.includes(b.value) ? "border-orange-500 bg-orange-200 text-orange-900" : "border-orange-300 bg-white text-orange-800"}`}>
                <input type="checkbox" checked={blockTypes.includes(b.value)} onChange={() => toggleType(b.value)} className="h-3 w-3 accent-orange-600" />
                {b.label}
              </label>
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <input value={blockNote} onChange={(e) => setBlockNote(e.target.value)} placeholder="Add a note (what part / what info / who can help)…" className="flex-1 rounded-md border border-orange-300 px-2 py-0.5 text-xs" />
            <button type="button" disabled={pending || blockTypes.length === 0} onClick={() => run(async () => { const r = await markBlocked(task.id, blockTypes, blockNote); if (r.ok) { setBlockNote(""); setBlockTypes([]); setBlockOpen(false); } return r; })} className="rounded bg-orange-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-orange-700 disabled:opacity-50">Flag blocked</button>
          </div>
        </div>
      ) : null}

      {err ? <div className="mt-1 text-xs text-red-700">{err}</div> : null}
    </li>
  );
}
