"use client";

// Thin banner that appears at the very top of every page when an
// admin/manager is using "view as <tech>". Carries:
//   - the impersonated tech's name (so the impersonator never forgets)
//   - a Refresh button (router.refresh() — re-fetches server data without
//     reloading the bundle — useful because the page doesn't auto-poll
//     while you watch)
//   - an Exit link (clears the cookie via /admin/view-as)

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import Link from "next/link";

export function ImpersonationBar({ techName, realEmail }: { techName: string; realEmail: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-3 border-b border-amber-300 bg-amber-100 px-3 py-1.5 text-xs text-amber-900">
      <span>
        Viewing as <strong className="font-semibold">{techName}</strong>
        <span className="ml-2 text-amber-700/70">· signed in {realEmail}</span>
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
        className="rounded-md border border-amber-400 bg-white px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60"
      >
        {pending ? "Refreshing…" : "↻ Refresh"}
      </button>
      <Link
        href="/admin/view-as"
        className="rounded-md border border-amber-400 bg-white px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-50"
      >
        Exit
      </Link>
    </div>
  );
}
