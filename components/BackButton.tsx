"use client";

// Generic "go back one page" button (browser history). Shown top-left on every
// page via PageShell when the page doesn't specify an explicit backHref —
// matters most in the installed PWA, which has no browser back button.
// Hidden on the home page (nowhere sensible to go back to).

import { useRouter, usePathname } from "next/navigation";

export function BackButton({ label = "Back" }: { label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="mb-2 inline-flex items-center text-xs font-medium text-neutral-500 hover:text-brand-700"
    >
      ← {label}
    </button>
  );
}
