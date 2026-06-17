"use client";

// "Refresh from HCP" — on-demand pull of this job's latest invoice + line items
// from HCP into TPAR-DB. Closes the draft-invoice blind spot: a line added in HCP
// before the invoice is sent/paid produces no webhook, so it otherwise wouldn't
// show until the next daily sync. (Danny 2026-06-17)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshJobFromHcp } from "@/app/job/[id]/trigger-actions";

export function RefreshFromHcpButton({ hcpJobId }: { hcpJobId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const router = useRouter();

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        title="Pull this job's latest invoice + line items from HCP"
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await refreshJobFromHcp(hcpJobId);
            setOk(r.ok);
            setMsg(r.message);
            if (r.ok) router.refresh();
          })
        }
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
      >
        {pending ? "Refreshing…" : "↻ Refresh from HCP"}
      </button>
      {msg ? (
        <span className={`text-xs ${ok === false ? "text-red-700" : "text-neutral-600"}`}>{msg}</span>
      ) : null}
    </span>
  );
}
