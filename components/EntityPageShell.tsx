// EntityPageShell — layout B "Clipboard" (Danny's pick, 2026-07-13, from the
// three mockups): checklist strip across the top, facts pinned in a sticky
// left rail (customer, address, map + Street View, money, status), working
// column on the right. Used INSIDE PageShell (which keeps the page chrome and
// the one actions bar). Fixed element order is the contract: a tech who
// learns estimate #40 knows estimate #4,000. Estimate page first; the job
// page migrates after a soak (plan section 3.2).

import type { ReactNode } from "react";

export type ChecklistItem = {
  label: string;
  state: "done" | "now" | "todo" | "dead";
};

// The lifecycle strip. "dead" renders the whole strip in its canceled form —
// honest about estimates that will never advance.
export function EntityChecklist({ items }: { items: ChecklistItem[] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {items.map((it) => (
        <span
          key={it.label}
          className={
            it.state === "done"
              ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200"
              : it.state === "now"
                ? "rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800 ring-2 ring-inset ring-brand-400"
                : it.state === "dead"
                  ? "rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200"
                  : "rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500"
          }
        >
          {it.state === "done" ? "✓ " : ""}
          {it.label}
        </span>
      ))}
    </div>
  );
}

// The two-lane body: sticky facts rail + scrolling working column.
// On phones the rail stacks on top by default (the mockup's stated tradeoff).
// mobileRailLast flips that for pages where the column's first control is
// doctrine — the job page's trigger bar stays on top on a phone (Danny
// 2026-06-15), with the facts rail below it.
export function EntityPageShell({
  checklist,
  rail,
  children,
  mobileRailLast = false,
}: {
  checklist?: ReactNode;
  rail: ReactNode;
  children: ReactNode;
  mobileRailLast?: boolean;
}) {
  return (
    <div>
      {checklist}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className={`flex flex-col gap-3 self-start lg:sticky lg:top-4 ${mobileRailLast ? "order-2 lg:order-1" : ""}`}>{rail}</aside>
        <div className={`flex min-w-0 flex-col gap-4 ${mobileRailLast ? "order-1 lg:order-2" : ""}`}>{children}</div>
      </div>
    </div>
  );
}

// A rail fact card — the fixed-place building block of the left lane.
export function RailCard({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
      {label ? (
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500">{label}</div>
      ) : null}
      {children}
    </div>
  );
}
