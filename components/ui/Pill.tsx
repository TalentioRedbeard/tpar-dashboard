// Single source of truth for status / tone pills.
// Use semantic tones, never raw colors. Sizes: "sm" (default) for inline,
// "md" for emphasis. Use `mono` for fixed-width identifiers.

import type { ReactNode } from "react";

export type Tone = "neutral" | "brand" | "green" | "amber" | "red" | "violet" | "slate";

const TONE: Record<Tone, string> = {
  neutral: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  brand:   "bg-brand-50 text-brand-800 ring-brand-200",
  green:   "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber:   "bg-accent-50 text-accent-700 ring-accent-100",
  red:     "bg-red-50 text-red-800 ring-red-200",
  violet:  "bg-violet-50 text-violet-800 ring-violet-200",
  slate:   "bg-neutral-50 text-neutral-600 ring-neutral-200",
};

export function Pill({
  children,
  tone = "neutral",
  size = "sm",
  mono = false,
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  size?: "sm" | "md";
  mono?: boolean;
  className?: string;
}) {
  const sizeCls = size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-xs";
  const monoCls = mono ? "font-mono" : "font-medium";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full ring-1 ring-inset ${sizeCls} ${monoCls} ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
