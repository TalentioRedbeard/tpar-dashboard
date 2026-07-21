"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEstimate } from "./actions";

const STATUS_OPTIONS = ["draft", "preview", "approved", "pushed", "archived"];

export function EstimateEditForm({
  id,
  initialStatus,
  initialProjectName,
  canEdit,
}: {
  id: string;
  initialStatus: string | null;
  initialProjectName: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<string>(initialStatus ?? "draft");
  const [projectName, setProjectName] = useState<string>(initialProjectName ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function save() {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await updateEstimate(id, { status, projectName });
      if (res.ok) {
        setMsg("Saved.");
        router.refresh();
      } else {
        setErr(res.error ?? "Couldn't save.");
      }
    });
  }

  const input = "w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-navy-700 focus:outline-none disabled:bg-neutral-50";

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-semibold text-neutral-900">Edit estimate</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-neutral-500">Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={!canEdit || pending}
            className={input}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-neutral-500 sm:col-span-2">Project name
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            disabled={!canEdit || pending}
            placeholder="e.g. Sewer tap rebuild"
            className={input}
          />
        </label>
      </div>

      {err ? <div className="mt-2 text-xs text-red-600">{err}</div> : null}
      {msg ? <div className="mt-2 text-xs text-emerald-700">{msg}</div> : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!canEdit || pending}
          className="rounded-md bg-navy-800 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-navy-900 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {!canEdit ? (
          <span className="text-xs italic text-neutral-500">View-only — leadership to edit.</span>
        ) : null}
      </div>
    </div>
  );
}
