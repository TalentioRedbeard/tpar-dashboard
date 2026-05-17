// /chat — public-facing layout. NO auth, NO global Nav, NO PageShell — this is
// a customer-facing surface, kept distinct from the internal dashboard chrome.

import type { ReactNode } from "react";
import "../globals.css";

export const metadata = {
  title: "Tulsa Plumbing Pricing Bot — get a ballpark in 2 minutes",
  description: "Quick estimate from Tulsa Plumbing & Remodeling. Tell us what's going on and we'll send a ballpark range — owner reviews every quote before any visit.",
  robots: { index: true, follow: true },
};

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
