"use client";

// Per-job WORKLIST with task distribution (Danny+Cody 2026-06-15). v1 = FYI:
// the lead (or office) adds tasks and assigns them to crew; each crew member sees
// the list, their own tasks highlighted, and can check tasks done. No accept/decline
// yet. Builds on the existing job_tasks substrate + lib/job-tasks.ts actions.

import { useState, useTransition } from "react";
import { addJobTask, setJobTaskStatus, assignJobTask, type JobTask } from "../lib/job-tasks";

const UNASSIGNED = "__unassigned__";

export function WorklistCard({
  hcpJobId,
  tasks,
  canWrite,
  canAssign,
  crew,
  myShortName,
}: {
  hcpJobId: string;
  tasks: JobTask[];
  canWrite: boolean;
  canAssign: boolean;
  crew: string[];
  myShortName: string | null;
}) {
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const doneCount = tasks.filter((t) => t.status === "done").length;

  function addTask() {
    setError(null);
    const title = newTitle.trim();
    if (!title) return;
    startTransition(async () => {
      const r = await addJobTask({ hcp_job_id: hcpJobId, title });
      if (!r.ok) { setError(r.error); return; }
      setNewTitle("");
    });
  }

  function toggleDone(t: JobTask) {
    setBusyId(t.id);
    startTransition(async () => {
      const r = await setJobTaskStatus({ task_id: t.id, hcp_job_id: hcpJobId, status: t.status === "done" ? "todo" : "done" });
      if (!r.ok) setError(r.error);
      setBusyId(null);
    });
  }

  function assign(t: JobTask, value: string) {
    setBusyId(t.id);
    startTransition(async () => {
      const r = await assignJobTask({ task_id: t.id, hcp_job_id: hcpJobId, assignee: value === UNASSIGNED ? null : value });
      if (!r.ok) setError(r.error);
      setBusyId(null);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <span>{tasks.length === 0 ? "No tasks yet." : `${doneCount}/${tasks.length} done`}</span>
        {canAssign ? <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-700">You can assign</span> : null}
      </div>

      {tasks.length > 0 ? (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          {tasks.map((t) => {
            const mine = !!myShortName && t.assignee === myShortName;
            const done = t.status === "done";
            return (
              <li key={t.id} className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${mine ? "bg-brand-50/40" : ""}`}>
                <input
                  type="checkbox"
                  checked={done}
                  disabled={!canWrite || (busyId === t.id && isPending)}
                  onChange={() => toggleDone(t)}
                  className="h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
                />
                <span className={`flex-1 text-sm ${done ? "text-neutral-400 line-through" : "text-neutral-900"}`}>
                  {t.title}
                  {t.requires_photo ? <span className="ml-1.5 text-[10px] uppercase tracking-wide text-neutral-400">📷 photo</span> : null}
                  {t.requires_note ? <span className="ml-1.5 text-[10px] uppercase tracking-wide text-neutral-400">📝 note</span> : null}
                </span>
                {canAssign ? (
                  <select
                    value={t.assignee ?? UNASSIGNED}
                    disabled={busyId === t.id && isPending}
                    onChange={(e) => assign(t, e.target.value)}
                    className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value={UNASSIGNED}>Unassigned</option>
                    {crew.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : t.assignee ? (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${mine ? "bg-brand-100 text-brand-800" : "bg-neutral-100 text-neutral-600"}`}>
                    {mine ? "You" : t.assignee}
                  </span>
                ) : (
                  <span className="text-[11px] text-neutral-400">unassigned</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {canWrite ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTask(); } }}
            placeholder="Add a task…"
            className="block flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button type="button" onClick={addTask} disabled={isPending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            + Task
          </button>
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
