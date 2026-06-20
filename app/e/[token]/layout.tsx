// /e/[token] — public-facing hosted estimate view. NO auth, NO global Nav, NO
// PageShell (PageShell calls getCurrentTech() which throws for an anonymous
// customer). Mirrors app/chat/layout.tsx, but robots NOINDEX — an estimate is
// private and must never be indexed or followed.

import type { ReactNode } from "react";
import "../../globals.css";

export const metadata = {
  title: "Your estimate · Tulsa Plumbing & Remodeling",
  description: "View your estimate from Tulsa Plumbing & Remodeling.",
  robots: { index: false, follow: false },
};

export default function EstimateViewLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#f7f2e4] text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
