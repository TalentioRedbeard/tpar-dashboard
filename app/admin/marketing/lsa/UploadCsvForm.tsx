"use client";

import { useActionState } from "react";
import { uploadLsaCsv, type UploadResult } from "./actions";

const initial: UploadResult | null = null;

export function UploadCsvForm() {
  const [state, action, pending] = useActionState<UploadResult | null, FormData>(
    uploadLsaCsv,
    initial,
  );

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input
        type="file"
        name="csv"
        accept=".csv,text/csv"
        required
        disabled={pending}
        className="block max-w-xs cursor-pointer rounded-md border border-neutral-300 bg-white text-xs file:mr-3 file:cursor-pointer file:rounded-l-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-neutral-800 hover:file:bg-neutral-200"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-60"
      >
        {pending ? "Uploading…" : "Upload + ingest"}
      </button>
      {state && state.ok && (
        <span className="text-xs text-emerald-700">
          ✓ {state.rows_seen} rows · upserted {state.upserted}.
        </span>
      )}
      {state && !state.ok && (
        <span className="text-xs text-red-700">{state.error}</span>
      )}
    </form>
  );
}
