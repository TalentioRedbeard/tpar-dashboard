"use client";

// Dispatch Task List (Danny 2026-05-31). Add + assign tasks; each task builds a
// list of requirements + needed skillsets. "📨 Note to Danny" flags a gap to the
// owner. Server actions revalidate /dispatch; we router.refresh() for snappiness.
//
// Task System v1 (2026-06-24): blocked tasks render with their blocker requirement(s)
// + an "Add requirement task" action (spawnChildTask → person OR role). Child tasks
// nest under their parent. When all children of a blocked parent resolve, the server
// auto-returns the parent to in_progress (see lib/tasks.ts maybeUnblockParent).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTask, setTaskStatus, assignTask, addRequirement, sendNoteToDanny, spawnChildTask } from "../lib/tasks";
import { BLOCKER_TYPES, isBlockerReq, type Task, type TaskStatus } from "../lib/task-types";
import { ScrollPanel } from "./ui/ScrollPanel";
import { SendNudgeButton } from "./SendNudgeButton";

type Res = { ok: boolean; error?: string };

export function TaskList({ tasks, techNames, roleNames = ["team", "tech", "manager", "office", "procurement"] }: { tasks: Task[]; techNames: string[]; roleNames?: string[] }) {
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

  // Children nest under their parent — never render them as top-level rows.
  const childrenByParent = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parent_task_id) {
      const arr = childrenByParent.get(t.parent_task_id) ?? [];
      arr.push(t);
      childrenByParent.set(t.parent_task_id, arr);
    }
  }
  const topLevel = tasks.filter((t) => !t.parent_task_id);
  const open = topLevel.filter((t) => t.status !== "done" && t.status !== "canceled");
  const done = topLevel.filter((t) => t.status === "done" || t.status === "canceled");

  return (
    <div className="rounded-2xl border border-neutral-200 border-t-[3px] border-t-slate-400 bg-white p-4">
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
        <ScrollPanel tier="secondary"><ul className="space-y-2">{open.map((t) => <TaskRow key={t.id} task={t} childTasks={childrenByParent.get(t.id) ?? []} techNames={techNames} roleNames={roleNames} run={run} pending={pending} />)}</ul></ScrollPanel>
      )}
      {done.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-neutral-500">Done ({done.length})</summary>
          <ul className="mt-2 space-y-1">{done.map((t) => <li key={t.id} className="flex items-center gap-2 text-xs text-neutral-400"><span className="line-through">{t.title}{t.assigned_to ? ` · ${t.assigned_to}` : ""}{t.status === "canceled" ? " (canceled)" : ""}</span>{t.status !== "canceled" ? <button type="button" disabled={pending} onClick={() => run(() => setTaskStatus(t.id, "open"))} className="text-[10px] text-neutral-500 hover:underline">reopen</button> : null}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function statusChip(status: TaskStatus) {
  switch (status) {
    case "in_progress": return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">in progress</span>;
    case "blocked":     return <span className="rounded bg-orange-200 px-1.5 py-0.5 text-[10px] font-medium text-orange-900">🚧 blocked</span>;
    case "done":        return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">done</span>;
    case "canceled":    return <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">canceled</span>;
    default:            return <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">open</span>;
  }
}

function TaskRow({ task, childTasks, techNames, roleNames, run, pending }: { task: Task; childTasks: Task[]; techNames: string[]; roleNames: string[]; run: (fn: () => Promise<Res>) => void; pending: boolean }) {
  const [reqText, setReqText] = useState("");
  const [reqKind, setReqKind] = useState<"requirement" | "skill">("requirement");
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  // Spawn-child (requirement task) form state.
  const [childOpen, setChildOpen] = useState(false);
  const [childTitle, setChildTitle] = useState("");
  const [childTarget, setChildTarget] = useState(""); // "tech:Name" or "role:team" or ""
  const isBlocked = task.status === "blocked";
  const blockerReqs = task.requirements.filter(isBlockerReq);

  return (
    <li className={`rounded-xl border p-2.5 ${isBlocked ? "border-orange-300 bg-orange-50" : "border-neutral-200 bg-neutral-50"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {statusChip(task.status)}
        <span className="font-medium text-neutral-900">{task.title}</span>
        {task.source ? <span className="rounded bg-neutral-200 px-1 py-0.5 text-[9px] uppercase tracking-wide text-neutral-600">{task.source}</span> : null}
        <select value={task.assigned_to ?? ""} onChange={(e) => run(() => assignTask(task.id, e.target.value))} disabled={pending} className="rounded-md border border-neutral-300 bg-white px-1.5 py-0.5 text-xs">
          <option value="">{task.assigned_role ? `Role: ${task.assigned_role}` : "Unassigned"}</option>
          {techNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {task.tech_response === "accepted" && !isBlocked ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">✓ accepted</span> : null}
        {task.tech_response === "declined" ? <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-800">✕ can&apos;t do</span> : null}
        <span className="ml-auto flex items-center gap-1">
          {task.ref_kind === "estimate_nudge_approval" ? <SendNudgeButton taskId={task.id} /> : null}
          {isBlocked ? (
            <button type="button" onClick={() => setChildOpen((o) => !o)} className="rounded border border-orange-400 bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-900 hover:bg-orange-200">+ requirement task</button>
          ) : null}
          {task.status !== "in_progress" && task.status !== "blocked" ? <button type="button" disabled={pending} onClick={() => run(() => setTaskStatus(task.id, "in_progress"))} className="rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[10px] text-amber-800 hover:bg-amber-50">Start</button> : null}
          <button type="button" disabled={pending} onClick={() => run(() => setTaskStatus(task.id, "done"))} className="rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] text-emerald-800 hover:bg-emerald-50">✓ Done</button>
        </span>
      </div>
      {task.detail ? <div className="mt-1 text-xs text-neutral-600">{task.detail}</div> : null}
      {task.tech_response === "declined" && task.tech_response_note ? <div className="mt-1 text-xs italic text-rose-700">{task.assigned_to ?? "tech"} can&apos;t do this: “{task.tech_response_note}”</div> : null}

      {/* Blocker requirement(s) surfaced on the blocked parent. */}
      {blockerReqs.length > 0 ? (
        <div className="mt-1.5 space-y-1">
          {blockerReqs.map((r, i) => (
            <div key={i} className="rounded-md border border-orange-200 bg-white/70 px-2 py-1 text-[11px] text-orange-900">
              🚧 Blocked — needs: <span className="font-medium">{r.types.map((t) => BLOCKER_TYPES.find((b) => b.value === t)?.label ?? t).join(", ")}</span>
              {r.note ? <span className="italic"> — “{r.note}”</span> : null}
              {r.added_by ? <span className="text-orange-700/70"> · {r.added_by}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Non-blocker requirement chips. */}
      {task.requirements.some((r) => !isBlockerReq(r)) ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.requirements.map((r, i) => isBlockerReq(r) ? null : <span key={i} className={`rounded px-1.5 py-0.5 text-[10px] ${r.kind === "skill" ? "bg-violet-100 text-violet-800" : "bg-neutral-200 text-neutral-700"}`}>{r.kind === "skill" ? "🛠 " : "• "}{r.text}</span>)}
        </div>
      ) : null}

      {/* Spawn requirement task (child) — person OR role. */}
      {childOpen && isBlocked ? (
        <div className="mt-1.5 rounded-lg border border-orange-300 bg-orange-100/60 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-orange-800">Add requirement task</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <input value={childTitle} onChange={(e) => setChildTitle(e.target.value)} placeholder="e.g. Procure ¾in brass ball valve…" className="min-w-[160px] flex-1 rounded-md border border-orange-300 px-2 py-0.5 text-xs" />
            <select value={childTarget} onChange={(e) => setChildTarget(e.target.value)} className="rounded-md border border-orange-300 bg-white px-1.5 py-0.5 text-xs">
              <option value="">Assign to…</option>
              <optgroup label="Person">
                {techNames.map((n) => <option key={`t:${n}`} value={`tech:${n}`}>{n}</option>)}
              </optgroup>
              <optgroup label="Role">
                {roleNames.map((r) => <option key={`r:${r}`} value={`role:${r}`}>{r}</option>)}
              </optgroup>
            </select>
            <button type="button" disabled={pending || !childTitle.trim()} onClick={() => run(async () => {
              const assignedTo = childTarget.startsWith("tech:") ? childTarget.slice(5) : undefined;
              const assignedRole = childTarget.startsWith("role:") ? childTarget.slice(5) : undefined;
              const r = await spawnChildTask(task.id, { title: childTitle, assignedTo, assignedRole });
              if (r.ok) { setChildTitle(""); setChildTarget(""); setChildOpen(false); }
              return r;
            })} className="rounded bg-orange-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-orange-700 disabled:opacity-50">+ add</button>
          </div>
        </div>
      ) : null}

      {/* Nested child (requirement) tasks. */}
      {childTasks.length > 0 ? (
        <ul className="mt-2 space-y-1.5 border-l-2 border-orange-200 pl-2.5">
          {childTasks.map((c) => (
            <li key={c.id} className="rounded-lg border border-neutral-200 bg-white p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-orange-700">↳ requirement</span>
                {statusChip(c.status)}
                <span className="text-xs font-medium text-neutral-900">{c.title}</span>
                <span className="text-[11px] text-neutral-500">{c.assigned_to ? `· ${c.assigned_to}` : c.assigned_role ? `· role: ${c.assigned_role}` : "· unassigned"}</span>
                <span className="ml-auto flex items-center gap-1">
                  <select value={c.assigned_to ?? ""} onChange={(e) => run(() => assignTask(c.id, e.target.value))} disabled={pending} className="rounded-md border border-neutral-300 bg-white px-1 py-0.5 text-[10px]">
                    <option value="">{c.assigned_role ? `Role: ${c.assigned_role}` : "Unassigned"}</option>
                    {techNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  {c.status !== "done" && c.status !== "canceled" ? (
                    <button type="button" disabled={pending} onClick={() => run(() => setTaskStatus(c.id, "done"))} className="rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] text-emerald-800 hover:bg-emerald-50">✓ Done</button>
                  ) : null}
                </span>
              </div>
              {c.detail ? <div className="mt-0.5 text-[11px] text-neutral-600">{c.detail}</div> : null}
            </li>
          ))}
        </ul>
      ) : null}

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
