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
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={className}>
      {(title || action) && (
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            {title ? (
              <h2 className="text-base font-semibold tracking-tight text-neutral-900">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-xs text-neutral-500">{description}</p>
            ) : null}
          </div>
          {action ? <div className="flex items-center gap-2">{action}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}
