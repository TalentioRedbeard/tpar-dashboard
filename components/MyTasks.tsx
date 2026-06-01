"use client";

// Tech-facing task list (#18, Danny 2026-05-31). A tech sees tasks assigned to
// them and marks "I've got it" (accept) or "Can't do" (with a reason → flags
// Danny + records the missing skill on the task). Once accepted, they can mark
// it Done. The other side (assign / see responses) lives in the dispatch TaskList.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToTask, setTaskStatus, type Task } from "../lib/tasks";
import { ScrollPanel } from "./ui/ScrollPanel";

export function MyTasks({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/40 p-4">
      <h3 className="mb-2 text-sm font-semibold text-sky-900">📋 Tasks for you · {tasks.length}</h3>
      <ScrollPanel tier="standard"><ul className="space-y-2">{tasks.map((t) => <MyTaskRow key={t.id} task={t} />)}</ul></ScrollPanel>
    </div>
  );
}

function MyTaskRow({ task }: { task: Task }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setErr(null);
    start(async () => { const r = await fn(); if (!r.ok) setErr(r.error ?? "failed"); else router.refresh(); });
  }

  const responded = task.tech_response;
  return (
    <li className="rounded-xl border border-sky-200 bg-white p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-neutral-900">{task.title}</span>
        {responded === "accepted" ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">✓ accepted</span> : null}
        {responded === "declined" ? <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-800">can&apos;t do</span> : null}
        <span className="ml-auto flex items-center gap-1.5">
          {!responded ? (
            <>
              <button type="button" disabled={pending} onClick={() => run(() => respondToTask(task.id, "accepted"))} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">I&apos;ve got it</button>
              <button type="button" disabled={pending} onClick={() => setDeclineOpen((o) => !o)} className="rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs text-rose-800 hover:bg-rose-100">Can&apos;t do</button>
            </>
          ) : responded === "accepted" ? (
            <button type="button" disabled={pending} onClick={() => run(() => setTaskStatus(task.id, "done"))} className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-50">✓ Done</button>
          ) : null}
        </span>
      </div>
      {task.detail ? <div className="mt-1 text-xs text-neutral-600">{task.detail}</div> : null}
      {task.requirements.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.requirements.map((r, i) => <span key={i} className={`rounded px-1.5 py-0.5 text-[10px] ${r.kind === "skill" ? "bg-violet-100 text-violet-800" : "bg-neutral-200 text-neutral-700"}`}>{r.kind === "skill" ? "🛠 " : "• "}{r.text}</span>)}
        </div>
      ) : null}
      {responded === "declined" && task.tech_response_note ? <div className="mt-1 text-xs italic text-rose-700">“{task.tech_response_note}”</div> : null}
      {declineOpen && !responded ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What's missing? (skill, tool, info) — goes to Danny" className="flex-1 rounded-md border border-rose-300 px-2 py-0.5 text-xs" />
          <button type="button" disabled={pending || !reason.trim()} onClick={() => run(async () => { const r = await respondToTask(task.id, "declined", reason); if (r.ok) { setReason(""); setDeclineOpen(false); } return r; })} className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-rose-700 disabled:opacity-50">Send</button>
        </div>
      ) : null}
      {err ? <div className="mt-1 text-xs text-red-700">{err}</div> : null}
    </li>
  );
}
