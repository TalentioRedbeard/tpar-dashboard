// Button — small set of variants used across the app. Most CTAs render as
// a Link, so this is a className-only helper plus a <button> wrapper.

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT: Record<ButtonVariant, string> = {
  primary:   "bg-brand-700 text-white hover:bg-brand-800 ring-1 ring-inset ring-brand-700 disabled:opacity-50",
  secondary: "bg-white text-neutral-800 hover:bg-neutral-50 ring-1 ring-inset ring-neutral-300 disabled:opacity-50",
  ghost:     "bg-transparent text-neutral-700 hover:bg-neutral-100",
  danger:    "bg-red-600 text-white hover:bg-red-700 ring-1 ring-inset ring-red-600 disabled:opacity-50",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-2 text-sm",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = "") {
  return `inline-flex items-center justify-center rounded-md font-medium transition ${VARIANT[variant]} ${SIZE[size]} ${extra}`.trim();
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; children: ReactNode }) {
  return (
    <button className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
  prefetch,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  prefetch?: boolean;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} prefetch={prefetch} {...rest}>
      {children}
    </Link>
  );
}
