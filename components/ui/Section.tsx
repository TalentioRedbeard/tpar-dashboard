// Section — uniform wrapper for page sections. Title + optional description
// + optional action slot. Body slot is the content. Standard vertical
// rhythm; pages stack <Section>s with space-y-* on the page wrapper.

import type { ReactNode } from "react";

export function Section({
  title,
  description,
  action,
  children,
  id,
  className = "",
  divider = false,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
  /** Subtle separator under the header. Off by default — opt in for dense pages. */
  divider?: boolean;
}) {
  return (
    <section id={id} className={className}>
      {(title || action) && (
        <header
          className={`mb-4 flex flex-wrap items-baseline justify-between gap-2 ${
            divider ? "border-b border-neutral-200/70 pb-3" : ""
          }`}
        >
          <div>
            {title ? (
              <h2 className="text-base font-semibold tracking-tight text-neutral-900">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-xs leading-relaxed text-neutral-500">{description}</p>
            ) : null}
          </div>
          {action ? <div className="flex items-center gap-2">{action}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}
