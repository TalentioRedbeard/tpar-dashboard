"use client";

import { useFormStatus } from "react-dom";
import { retestIntegrations } from "./actions";

function Inner() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
    >
      {pending ? "Re-testing…" : "↻ Re-test now"}
    </button>
  );
}

export function RetestButton() {
  return (
    <form action={retestIntegrations}>
      <Inner />
    </form>
  );
}
