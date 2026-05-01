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
    <div className={`rounded-2xl border p-8 text-center ${variantCls}`}>
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      {description ? (
        <p className="mt-1 text-xs text-neutral-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
