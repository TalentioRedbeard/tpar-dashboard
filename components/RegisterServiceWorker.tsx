// Tiny client component that registers /sw.js on mount. Lives in layout.tsx
// so every page is covered. No UI; ambient registration only.

"use client";

import { useEffect } from "react";

export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Only register in production-ish contexts. In dev with HMR a SW is
    // usually noise; behind localhost we still register so behavior can
    // be exercised end-to-end.
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[sw] registration failed", err);
      });
  }, []);
  return null;
}
