// Always-visible banner when leadership is using "view as tech" mode.
// Sticky to the top of every page so it can't be forgotten.

import Link from "next/link";
import { clearViewAsTech } from "../app/admin/view-as/actions";

export function ImpersonationBanner({
  techShortName,
  realEmail,
}: {
  techShortName: string;
  realEmail: string;
}) {
  return (
    <div className="sticky top-0 z-40 border-b border-amber-300 bg-amber-100 text-amber-900">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden>👁️</span>
          <span>
            <strong>Viewing as {techShortName}</strong>
            <span className="ml-2 text-xs text-amber-800">
              (signed in as {realEmail})
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/view-as"
            className="rounded-md bg-white/60 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-300 hover:bg-white"
          >
            Switch tech
          </Link>
          <form action={clearViewAsTech}>
            <button
              type="submit"
              className="rounded-md bg-amber-700 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-800"
            >
              Exit view-as
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
