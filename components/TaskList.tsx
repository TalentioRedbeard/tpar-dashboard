"use client";

// Dispatch Task List (Danny 2026-05-31). Add + assign tasks; each task builds a
// list of requirements + needed skillsets. "📨 Note to Danny" flags a gap to the
// owner. Server actions revalidate /dispatch; we router.refresh() for snappiness.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTask, setTaskStatus, assignTask, addRequirement, sendNoteToDanny, type Task } from "../lib/tasks";
import { ScrollPanel } from "./ui/ScrollPanel";

type Res = { ok: boolean; error?: string };

export function TaskList({ tasks, techNames }: { tasks: Task[]; techNames: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function run(fn: () => Promise<Res>) {
    setErr(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "failed");
      else router.refresh();
    });
  }

  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-900">📋 Task List</h3>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task…" className="min-w-[180px] flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm">
          <option value="">Unassigned</option>
          {techNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button type="button" disabled={pending || !title.trim()} onClick={() => run(async () => { const r = await createTask({ title, assigned_to: assignee }); if (r.ok) { setTitle(""); setAssignee(""); } return r; })} className="rounded-md bg-brand-700 px-3 py-1 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">Add</button>
      </div>
      {err ? <div className="mb-2 text-xs text-red-700">{err}</div> : null}
      {open.length === 0 ? <div className="text-sm text-neutral-500">No open tasks.</div> : (
        <ScrollPanel tier="secondary"><ul className="space-y-2">{open.map((t) => <TaskRow key={t.id} task={t} techNames={techNames} run={run} pending={pending} />)}</ul></ScrollPanel>
      )}
      {done.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-neutral-500">Done ({done.length})</summary>
          <ul className="mt-2 space-y-1">{done.map((t) => <li key={t.id} className="flex items-center gap-2 text-xs text-neutral-400"><span className="line-through">{t.title}{t.assigned_to ? ` · ${t.assigned_to}` : ""}</span><button type="button" disabled={pending} onClick={() => run(() => setTaskStatus(t.id, "open"))} className="text-[10px] text-neutral-500 hover:underline">reopen</button></li>)}</ul>
        </details>
      )}
    </div>
  );
}

function TaskRow({ task, techNames, run, pending }: { task: Task; techNames: string[]; run: (fn: () => Promise<Res>) => void; pending: boolean }) {
  const [reqText, setReqText] = useState("");
  const [reqKind, setReqKind] = useState<"requirement" | "skill">("requirement");
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <li className="rounded-xl border border-neutral-200 bg-neutral-50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${task.status === "in_progress" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>{task.status === "in_progress" ? "in progress" : "open"}</span>
        <span className="font-medium text-neutral-900">{task.title}</span>
        <select value={task.assigned_to ?? ""} onChange={(e) => run(() => assignTask(task.id, e.target.value))} disabled={pending} className="rounded-md border border-neutral-300 bg-white px-1.5 py-0.5 text-xs">
          <option value="">Unassigned</option>
          {techNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {task.tech_response === "accepted" ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">✓ accepted</span> : null}
        {task.tech_response === "declined" ? <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-800">✕ can&apos;t do</span> : null}
        <span className="ml-auto flex items-center gap-1">
          {task.status !== "in_progress" ? <button type="button" disabled={pending} onClick={() => run(() => setTaskStatus(task.id, "in_progress"))} className="rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[10px] text-amber-800 hover:bg-amber-50">Start</button> : null}
          <button type="button" disabled={pending} onClick={() => run(() => setTaskStatus(task.id, "done"))} className="rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] text-emerald-800 hover:bg-emerald-50">✓ Done</button>
        </span>
      </div>
      {task.detail ? <div className="mt-1 text-xs text-neutral-600">{task.detail}</div> : null}
      {task.tech_response === "declined" && task.tech_response_note ? <div className="mt-1 text-xs italic text-rose-700">{task.assigned_to ?? "tech"} can&apos;t do this: “{task.tech_response_note}”</div> : null}
      {task.requirements.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.requirements.map((r, i) => <span key={i} className={`rounded px-1.5 py-0.5 text-[10px] ${r.kind === "skill" ? "bg-violet-100 text-violet-800" : "bg-neutral-200 text-neutral-700"}`}>{r.kind === "skill" ? "🛠 " : "• "}{r.text}</span>)}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <input value={reqText} onChange={(e) => setReqText(e.target.value)} placeholder="add requirement / skill…" className="min-w-[140px] flex-1 rounded-md border border-neutral-300 px-2 py-0.5 text-xs" />
        <select value={reqKind} onChange={(e) => setReqKind(e.target.value as "requirement" | "skill")} className="rounded-md border border-neutral-300 px-1.5 py-0.5 text-xs"><option value="requirement">requirement</option><option value="skill">skill</option></select>
        <button type="button" disabled={pending || !reqText.trim()} onClick={() => run(async () => { const r = await addRequirement(task.id, { text: reqText, kind: reqKind }); if (r.ok) setReqText(""); return r; })} className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[10px] text-neutral-700 hover:bg-neutral-50">+ add</button>
        <button type="button" onClick={() => setNoteOpen((o) => !o)} className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100">📨 Note to Danny</button>
      </div>
      {noteOpen ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Flag to Danny — a requirement/skill for "${task.title}"…`} className="flex-1 rounded-md border border-amber-300 px-2 py-0.5 text-xs" />
          <button type="button" disabled={pending || !note.trim()} onClick={() => run(async () => { const r = await sendNoteToDanny(note, { taskId: task.id, taskTitle: task.title }); if (r.ok) { setNote(""); setNoteOpen(false); } return r; })} className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-amber-700">Send</button>
        </div>
      ) : null}
    </li>
  );
}
