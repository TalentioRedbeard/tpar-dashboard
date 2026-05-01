// Top nav for the unified TPAR app. Server component (no client state) —
// active-link highlighting via Next.js segment matching is acceptable.

import Link from "next/link";
import { isAdmin } from "../lib/admin";

const NAV_ITEMS = [
  { href: "/",            label: "Today" },
  { href: "/customers",   label: "Customers" },
  { href: "/jobs",        label: "Jobs" },
  { href: "/estimates",   label: "Estimates" },
  { href: "/comms",       label: "Comms" },
  { href: "/dispatch",    label: "Dispatch" },
  { href: "/reports",     label: "Reports" },
];

export function Nav({ userEmail, isTech }: { userEmail: string | null; isTech?: boolean }) {
  const showAdmin = isAdmin(userEmail);
  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-4 py-2 text-sm">
        <Link href="/" className="font-semibold tracking-tight text-neutral-900">
          TPAR-DB
        </Link>
        <ul className="flex flex-1 items-center gap-1 overflow-x-auto">
          {isTech ? (
            <li>
              <Link
                href="/me"
                className="inline-block whitespace-nowrap rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-emerald-800 hover:bg-emerald-100"
              >
                My day
              </Link>
            </li>
          ) : null}
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="inline-block whitespace-nowrap rounded-md px-3 py-1.5 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
              >
                {item.label}
              </Link>
            </li>
          ))}
          {showAdmin ? (
            <li>
              <Link
                href="/admin"
                className="inline-block whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-800 hover:bg-amber-100"
              >
                Admin
              </Link>
            </li>
          ) : null}
        </ul>
        <Link
          href="/search"
          className="inline-block whitespace-nowrap rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-600 hover:bg-neutral-50"
          prefetch={false}
        >
          🔎 Search
        </Link>
        {userEmail ? (
          <div className="flex items-center gap-3 text-neutral-600">
            <span className="hidden md:inline">{userEmail}</span>
            <form action="/auth/signout" method="POST">
              <button
                type="submit"
                className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Sign out
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
