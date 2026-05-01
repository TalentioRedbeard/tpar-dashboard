// Inline editor for one tech_directory row. Server action handles the
// write; this component just collects the form data and surfaces the result.

"use client";

import { useState, useTransition } from "react";
import { updateTechDirectory } from "../lib/admin-actions";

export function TechRowForm({
  techId,
  techShortName,
  hcpFullName,
  initialSlackUserId,
  initialIsActive,
  initialNotes,
}: {
  techId: string;
  techShortName: string;
  hcpFullName: string | null;
  initialSlackUserId: string | null;
  initialIsActive: boolean;
  initialNotes: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [slackId, setSlackId] = useState(initialSlackUserId ?? "");
  const [isActive, setIsActive] = useState(initialIsActive);
  const [notes, setNotes] = useState(initialNotes ?? "");

  const dirty =
    slackId.trim() !== (initialSlackUserId ?? "") ||
    isActive !== initialIsActive ||
    notes !== (initialNotes ?? "");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateTechDirectory(fd);
      if (res.ok) {
        setSavedAt(Date.now());
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-neutral-200 bg-white p-4">
      <input type="hidden" name="tech_id" value={techId} />
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-neutral-900">{techShortName}</h3>
          <p className="text-xs text-neutral-500">{hcpFullName ?? "(no HCP name)"} · tech_id={techId}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_active"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            disabled={isPending}
            className="h-4 w-4 rounded border-neutral-300"
          />
          <span className={isActive ? "text-emerald-700" : "text-neutral-500"}>
            {isActive ? "active" : "inactive"}
          </span>
        </label>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-neutral-600">Slack user ID</label>
        <input
          type="text"
          name="slack_user_id"
          value={slackId}
          onChange={(e) => setSlackId(e.target.value)}
          disabled={isPending}
          placeholder="U06AT0JSAC9"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-neutral-600">Notes</label>
        <textarea
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={4000}
          disabled={isPending}
          placeholder="Any operator notes about this tech (off-rotation, cert pending, etc.)"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || !dirty}
          className="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
        {savedAt && !error ? <span className="text-xs text-emerald-700">Saved.</span> : null}
      </div>
    </form>
  );
}
