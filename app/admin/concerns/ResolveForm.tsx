"use client";

import { useState, useTransition } from "react";
import { resolveConcern } from "./actions";

export function ResolveForm({ id }: { id: string }) {
  const [resolution, setResolution] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      if (resolution.trim()) fd.set("resolution", resolution.trim());
      const res = await resolveConcern(fd);
      if (!res.ok) setError(res.error ?? "failed");
    });
  }

  return (
    <div className="border-t border-neutral-100 bg-neutral-50/50 px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[280px]">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Resolution note (optional)</label>
          <input
            type="text"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="What did we decide / do?"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {pending ? "Resolving…" : "Mark discussed"}
        </button>
      </div>
      {error ? <div className="mt-1 text-xs text-red-700">{error}</div> : null}
    </div>
  );
}
