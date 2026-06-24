// /unsubscribed — public, no-login confirmation page. NO auth, NO global Nav, NO
// PageShell (PageShell calls getCurrentTech() which throws for an anonymous
// customer). Mirrors app/e/[token]/layout.tsx: its own <html>/<body> so the
// internal app chrome never renders, and robots NOINDEX — an unsubscribe
// confirmation must never be indexed or followed.
//
// A Supabase edge function processes the unsubscribe token, then 302-redirects
// the browser here with ?ok=1 (success) or ?ok=0 (failure).

import type { ReactNode } from "react";
import "../globals.css";

export const metadata = {
  title: "Unsubscribe · Tulsa Plumbing & Remodeling",
  description: "Manage your email preferences with Tulsa Plumbing & Remodeling.",
  robots: { index: false, follow: false },
};

export default function UnsubscribedLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#f7f2e4] text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
