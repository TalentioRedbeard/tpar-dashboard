"use client";

// Periodically re-fetch the current server component so a live board (the Today
// timeline) paints new lifecycle events as the day progresses, without a manual
// reload. Cheap: router.refresh() re-runs the RSC; force-dynamic pages re-query.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), Math.max(15, seconds) * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
