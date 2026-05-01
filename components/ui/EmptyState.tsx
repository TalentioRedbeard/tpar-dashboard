// EmptyState — uniform "nothing here yet" surface. Use for empty tables,
// empty sections, and "filter returned no results" cases. Optional action
// slot for "create first X" CTAs.

import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
  variant = "soft",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** "soft" = dashed border + light bg. "outlined" = solid border, less attention. */
  variant?: "soft" | "outlined";
}) {
  const variantCls =
    variant === "soft"
      ? "border-dashed border-neutral-300 bg-white"
      : "border-neutral-200 bg-white";
  return (
    <div className={`rounded-2xl border p-10 text-center ${variantCls}`}>
      <div className="mx-auto mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12h8" />
        </svg>
      </div>
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-md text-xs text-neutral-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
