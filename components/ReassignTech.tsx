"use client";

// Per-job reassign control on /dispatch (#27). Pick a tech → reassignJob PATCHes
// the HCP job's assigned employee via update-hcp-job, then the page refreshes.
// MGMT-gated at the server action; the button only renders for schedulers.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reassignJob } from "../lib/schedule-changes";

export function ReassignTech({ hcpJobId, current, techs }: {
  hcpJobId: string;
  current: string | null;
  techs: Array<{ full: string; short: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Reassign this job to a different tech"
        className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-100"
      >
        ⇄ Assign
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select
        defaultValue=""
        disabled={pending}
        onChange={(e) => {
          const full = e.target.value;
          if (!full) return;
          if (!window.confirm(`Reassign this job to ${full}?\n\nThis updates the assigned tech on the real HCP job.`)) {
            e.currentTarget.value = "";
            return;
          }
          start(async () => {
            const r = await reassignJob(hcpJobId, full);
            if (!r.ok) { setErr(r.error ?? "failed"); return; }
            setErr(null);
            setOpen(false);
            router.refresh();
          });
        }}
        className="rounded border border-neutral-300 px-1 py-0.5 text-[10px]"
      >
        <option value="">{pending ? "…" : "to…"}</option>
        {techs.filter((t) => t.full !== current).map((t) => (
          <option key={t.full} value={t.full}>{t.short}</option>
        ))}
      </select>
      <button type="button" onClick={() => { setOpen(false); setErr(null); }} className="text-[10px] text-neutral-400 hover:underline">×</button>
      {err ? <span className="text-[10px] text-red-600">{err}</span> : null}
    </span>
  );
}
