"use client";

// Downtime task bank (Task System v1, item b — 2026-06-24; management added
// 2026-07-20). Lists the ACTIVE tasks_master templates and lets a manager/lead
// "Assign" one to a tech OR a role (assignFromTemplate drops a tasks row with
// source='downtime-bank'). As of 2026-07-20 managers (admin|manager) can also run
// the library itself — create, edit, remove, and reorder/prioritize tasks — and
// every task carries real instructions (how to do it), an expected outcome (what
// "done" is), and what to report, so nobody has to guess how to do one.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignFromTemplate, createTaskTemplate, updateTaskTemplate, setTaskTemplateActive, moveTaskTemplate } from "../lib/tasks";
import { TASK_CATEGORIES, type TaskTemplate, type TaskTemplateInput, type TaskCategory } from "../lib/task-types";

type Res = { ok: boolean; error?: string };

export function TaskBank({
  templates,
  techNames,
  canManage = false,
  roleNames = ["team", "tech", "manager", "office", "procurement"],
}: {
  templates: TaskTemplate[];
  techNames: string[];
  canManage?: boolean;
  roleNames?: string[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <div className="rounded-2xl border border-neutral-200 border-t-[3px] border-t-teal-400 bg-white p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-900">🗂 Downtime task bank</h3>
        {canManage ? (
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="rounded-md border border-teal-300 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800 hover:bg-teal-100"
          >
            {creating ? "Cancel" : "＋ New task"}
          </button>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-neutral-500">
        Productive work for slow windows. Assign a template to a tech or a role.
        {canManage ? " Reorder to set priority, or edit any task to spell out how it's done." : null}
      </p>

      {canManage && creating ? (
        <div className="mb-3">
          <TaskEditor
            techNames={techNames}
            onDone={() => { setCreating(false); router.refresh(); }}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : null}

      {templates.length === 0 ? (
        <div className="text-sm text-neutral-500">No active templates.</div>
      ) : (
        <ul className="space-y-2">
          {templates.map((t, i) => (
            <BankRow
              key={t.id}
              tmpl={t}
              techNames={techNames}
              roleNames={roleNames}
              canManage={canManage}
              isFirst={i === 0}
              isLast={i === templates.length - 1}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function BankRow({
  tmpl, techNames, roleNames, canManage, isFirst, isLast,
}: {
  tmpl: TaskTemplate;
  techNames: string[];
  roleNames: string[];
  canManage: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState(""); // "tech:Name" | "role:team" | ""
  const [err, setErr] = useState<string | null>(null);
  const [assigned, setAssigned] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  function run(fn: () => Promise<Res>, onOk?: () => void) {
    setErr(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "failed");
      else { onOk?.(); router.refresh(); }
    });
  }

  if (editing) {
    return (
      <li className="rounded-xl border border-teal-200 bg-white p-2.5">
        <TaskEditor
          tmpl={tmpl}
          techNames={techNames}
          onDone={() => { setEditing(false); router.refresh(); }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  const hasDetail = !!(tmpl.instructions || tmpl.expected_outcome || tmpl.trackable_metric);

  return (
    <li className="rounded-xl border border-neutral-200 bg-neutral-50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <span className="flex flex-col leading-none">
            <button type="button" disabled={pending || isFirst} onClick={() => run(() => moveTaskTemplate(tmpl.id, "up"))} title="Move up (higher priority)" className="px-0.5 text-[10px] text-neutral-400 hover:text-neutral-800 disabled:opacity-30">▲</button>
            <button type="button" disabled={pending || isLast} onClick={() => run(() => moveTaskTemplate(tmpl.id, "down"))} title="Move down" className="px-0.5 text-[10px] text-neutral-400 hover:text-neutral-800 disabled:opacity-30">▼</button>
          </span>
        ) : null}
        <span className="font-medium text-neutral-900">{tmpl.task_name}</span>
        {tmpl.category ? <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-medium text-teal-800">{tmpl.category}</span> : null}
        {tmpl.estimated_minutes != null ? <span className="text-[11px] text-neutral-500">~{tmpl.estimated_minutes} min</span> : null}
        {tmpl.requires_geo ? <span className="text-[10px] text-amber-700" title={tmpl.geo_target ?? "GPS-verified location task"}>📍 on-site</span> : null}
        {tmpl.eligible_techs && tmpl.eligible_techs.length > 0 ? <span className="text-[10px] text-neutral-400">eligible: {tmpl.eligible_techs.join(", ")}</span> : null}
        <span className="ml-auto flex items-center gap-1.5">
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={pending} className="rounded-md border border-neutral-300 bg-white px-1.5 py-0.5 text-xs">
            <option value="">Assign to…</option>
            <optgroup label="Person">
              {techNames.map((n) => <option key={`t:${n}`} value={`tech:${n}`}>{n}</option>)}
            </optgroup>
            <optgroup label="Role">
              {roleNames.map((r) => <option key={`r:${r}`} value={`role:${r}`}>{r}</option>)}
            </optgroup>
          </select>
          <button
            type="button"
            disabled={pending || !target}
            onClick={() => run(
              () => {
                const assignedTo = target.startsWith("tech:") ? target.slice(5) : undefined;
                const assignedRole = target.startsWith("role:") ? target.slice(5) : undefined;
                return assignFromTemplate(tmpl.task_key, { assignedTo, assignedRole });
              },
              () => setAssigned(true),
            )}
            className="rounded-md bg-teal-700 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {pending ? "…" : assigned ? "✓ Assigned" : "Assign"}
          </button>
          {canManage ? (
            <>
              <button type="button" disabled={pending} onClick={() => setEditing(true)} className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100">Edit</button>
              {confirmRemove ? (
                <>
                  <button type="button" disabled={pending} onClick={() => run(() => setTaskTemplateActive(tmpl.id, false), () => setConfirmRemove(false))} className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700">Remove</button>
                  <button type="button" disabled={pending} onClick={() => setConfirmRemove(false)} className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100">Keep</button>
                </>
              ) : (
                <button type="button" disabled={pending} onClick={() => setConfirmRemove(true)} className="rounded-md border border-red-200 bg-white px-2 py-0.5 text-xs text-red-700 hover:bg-red-50" title="Remove from the bank">✕</button>
              )}
            </>
          ) : null}
        </span>
      </div>

      {hasDetail ? (
        <div className="mt-1">
          <button type="button" onClick={() => setShowDetail((o) => !o)} className="text-[11px] text-neutral-500 hover:underline">{showDetail ? "Hide instructions" : "Instructions"}</button>
          {showDetail ? (
            <div className="mt-1 space-y-2 rounded-md bg-white p-2.5 text-[11px] text-neutral-700">
              {tmpl.instructions ? (
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-neutral-400">How to do it</div>
                  <p className="whitespace-pre-wrap">{tmpl.instructions}</p>
                </div>
              ) : null}
              {tmpl.expected_outcome ? (
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-neutral-400">What “done” looks like</div>
                  <p className="whitespace-pre-wrap">{tmpl.expected_outcome}</p>
                </div>
              ) : null}
              {tmpl.trackable_metric ? (
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-neutral-400">What to report</div>
                  <p className="whitespace-pre-wrap">{tmpl.trackable_metric}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {err ? <div className="mt-1 text-[11px] text-red-700">{err}</div> : null}
    </li>
  );
}

// Shared create/edit form. `tmpl` present → edit; absent → create.
function TaskEditor({
  tmpl, techNames, onDone, onCancel,
}: {
  tmpl?: TaskTemplate;
  techNames: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(tmpl?.task_name ?? "");
  const [category, setCategory] = useState<TaskCategory>((tmpl?.category as TaskCategory) ?? "operational");
  const [instructions, setInstructions] = useState(tmpl?.instructions ?? "");
  const [outcome, setOutcome] = useState(tmpl?.expected_outcome ?? "");
  const [metric, setMetric] = useState(tmpl?.trackable_metric ?? "");
  const [minutes, setMinutes] = useState<string>(tmpl?.estimated_minutes != null ? String(tmpl.estimated_minutes) : "");
  const [eligible, setEligible] = useState<string[]>(tmpl?.eligible_techs ?? []);
  const [requiresGeo, setRequiresGeo] = useState<boolean>(tmpl?.requires_geo ?? false);
  const [geoTarget, setGeoTarget] = useState(tmpl?.geo_target ?? "");

  function toggleTech(n: string) {
    setEligible((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));
  }

  function submit() {
    setErr(null);
    const input: TaskTemplateInput = {
      task_name: name,
      category,
      instructions,
      expected_outcome: outcome,
      trackable_metric: metric,
      estimated_minutes: minutes.trim() ? Number(minutes) : null,
      eligible_techs: eligible,
      requires_geo: requiresGeo,
      geo_target: geoTarget,
    };
    start(async () => {
      const r = tmpl ? await updateTaskTemplate(tmpl.id, input) : await createTaskTemplate(input);
      if (!r.ok) setErr(r.error ?? "failed");
      else onDone();
    });
  }

  const labelCls = "block text-[10px] font-semibold uppercase tracking-wide text-neutral-500";
  const inputCls = "mt-0.5 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900";

  return (
    <div className="space-y-2 rounded-lg border border-teal-200 bg-teal-50/40 p-3">
      <div className="text-[11px] font-semibold text-teal-800">{tmpl ? "Edit task" : "New task"}</div>

      <label className="block">
        <span className={labelCls}>Task name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Clean and detail your vehicle" className={inputCls} />
      </label>

      <div className="flex gap-2">
        <label className="block flex-1">
          <span className={labelCls}>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as TaskCategory)} className={inputCls}>
            {TASK_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block w-28">
          <span className={labelCls}>Est. minutes</span>
          <input type="number" min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="~min" className={inputCls} />
        </label>
      </div>

      <label className="block">
        <span className={labelCls}>Instructions — how to do it <span className="text-red-500">*</span></span>
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={4} placeholder="Step-by-step so anyone can follow it without asking." className={inputCls} />
      </label>

      <label className="block">
        <span className={labelCls}>What “done” looks like</span>
        <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2} placeholder="The finished state / quality bar." className={inputCls} />
      </label>

      <label className="block">
        <span className={labelCls}>What to report back</span>
        <input value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="e.g. addresses visited, count, contact name, photos" className={inputCls} />
      </label>

      <div className="rounded-md border border-neutral-200 bg-white p-2">
        <label className="flex items-center gap-1.5 text-[11px] text-neutral-700">
          <input type="checkbox" checked={requiresGeo} onChange={(e) => setRequiresGeo(e.target.checked)} />
          Location-verified (GPS confirms they were on-site)
        </label>
        {requiresGeo ? (
          <input value={geoTarget} onChange={(e) => setGeoTarget(e.target.value)} placeholder="target area or address hint" className={`${inputCls} mt-1.5`} />
        ) : null}
      </div>

      <div>
        <span className={labelCls}>Eligible techs <span className="font-normal normal-case text-neutral-400">(none selected = anyone)</span></span>
        <div className="mt-1 flex flex-wrap gap-1">
          {techNames.map((n) => {
            const on = eligible.includes(n);
            return (
              <button key={n} type="button" onClick={() => toggleTech(n)} className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-teal-400 bg-teal-100 text-teal-800" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100"}`}>
                {on ? "✓ " : ""}{n}
              </button>
            );
          })}
        </div>
      </div>

      {err ? <div className="text-[11px] text-red-700">{err}</div> : null}

      <div className="flex items-center gap-2 pt-0.5">
        <button type="button" onClick={submit} disabled={pending} className="rounded-md bg-teal-700 px-3 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50">
          {pending ? "Saving…" : tmpl ? "Save changes" : "Create task"}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100">Cancel</button>
      </div>
    </div>
  );
}
