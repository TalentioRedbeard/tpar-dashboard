"use client";

// Sync now buttons for /admin/system. Each one is a server-action form
// that fires the corresponding edge fn and re-renders the page.

import { useFormStatus } from "react-dom";
import { syncFnManifest, regenOntology } from "./actions";

function PendingPill({ pending, label, doneLabel }: { pending: boolean; label: string; doneLabel: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
    >
      {pending ? `${label}…` : doneLabel}
    </button>
  );
}

function ManifestButtonInner() {
  const { pending } = useFormStatus();
  return <PendingPill pending={pending} label="Syncing" doneLabel="↻ Sync fn manifest" />;
}

function OntologyButtonInner() {
  const { pending } = useFormStatus();
  return <PendingPill pending={pending} label="Regenerating" doneLabel="↻ Regen ontology snapshot" />;
}

export function SyncButtons() {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      <form action={syncFnManifest}>
        <ManifestButtonInner />
      </form>
      <form action={regenOntology}>
        <OntologyButtonInner />
      </form>
      <span className="self-center text-xs text-neutral-500">
        Manifest auto-syncs nightly 01:37 Chicago. Ontology snapshot 01:17 Chicago.
      </span>
    </div>
  );
}
