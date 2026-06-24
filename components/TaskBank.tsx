"use client";

// Downtime task bank (Task System v1, item b — 2026-06-24). Lists the ACTIVE
// tasks_master templates (clean van, restock, study, photo audit, outreach route,
// …) and lets a manager/lead "Assign" one to a tech OR a role. Assigning drops a
// tasks row with template_key=task_key + source='downtime-bank' (see
// lib/tasks.ts assignFromTemplate). Read-only list + assign is enough for v1.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignFromTemplate } from "../lib/tasks";
import { type TaskTemplate } from "../lib/task-types";

type Res = { ok: boolean; error?: string };

export function TaskBank({ templates, techNames, roleNames = ["team", "tech", "manager", "office", "procurement"] }: { templates: TaskTemplate[]; techNames: string[]; roleNames?: string[] }) {
  return (
    <div className="rounded-2xl border border-neutral-200 border-t-[3px] border-t-teal-400 bg-white p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-900">🗂 Downtime task bank</h3>
      <p className="mb-3 text-xs text-neutral-500">Productive work for slow windows. Assign a template to a tech or a role.</p>
      {templates.length === 0 ? (
        <div className="text-sm text-neutral-500">No active templates.</div>
      ) : (
        <ul className="space-y-2">{templates.map((t) => <BankRow key={t.task_key} tmpl={t} techNames={techNames} roleNames={roleNames} />)}</ul>
      )}
    </div>
  );
}

function BankRow({ tmpl, techNames, roleNames }: { tmpl: TaskTemplate; techNames: string[]; roleNames: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState(""); // "tech:Name" | "role:team" | ""
  const [err, setErr] = useState<string | null>(null);
  const [assigned, setAssigned] = useState(false);
  const [showInstr, setShowInstr] = useState(false);

  function run(fn: () => Promise<Res>) {
    setErr(null);
    start(async () => { const r = await fn(); if (!r.ok) setErr(r.error ?? "failed"); else { setAssigned(true); router.refresh(); } });
  }

  return (
    <li className="rounded-xl border border-neutral-200 bg-neutral-50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-neutral-900">{tmpl.task_name}</span>
        {tmpl.category ? <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-medium text-teal-800">{tmpl.category}</span> : null}
        {tmpl.estimated_minutes != null ? <span className="text-[11px] text-neutral-500">~{tmpl.estimated_minutes} min</span> : null}
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
            onClick={() => run(() => {
              const assignedTo = target.startsWith("tech:") ? target.slice(5) : undefined;
              const assignedRole = target.startsWith("role:") ? target.slice(5) : undefined;
              return assignFromTemplate(tmpl.task_key, { assignedTo, assignedRole });
            })}
            className="rounded-md bg-teal-700 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {pending ? "Assigning…" : assigned ? "✓ Assigned" : "Assign"}
          </button>
        </span>
      </div>
      {tmpl.instructions ? (
        <div className="mt-1">
          <button type="button" onClick={() => setShowInstr((o) => !o)} className="text-[11px] text-neutral-500 hover:underline">{showInstr ? "Hide" : "Instructions"}</button>
          {showInstr ? <div className="mt-1 whitespace-pre-wrap rounded-md bg-white p-2 text-[11px] text-neutral-700">{tmpl.instructions}</div> : null}
        </div>
      ) : null}
      {err ? <div className="mt-1 text-[11px] text-red-700">{err}</div> : null}
    </li>
  );
}
