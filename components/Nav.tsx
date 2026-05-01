// Top nav for the unified TPAR app. Server component (no client state).
// Visual identity: brand wordmark on the left, slim pill-shaped links,
// admin highlighted in amber, signed-in email + sign-out on the right.

import Link from "next/link";
import { isAdmin } from "../lib/admin";
import { Wordmark } from "./ui/Brand";

const NAV_ITEMS = [
  { href: "/",          label: "Today" },
  { href: "/customers", label: "Customers" },
  { href: "/jobs",      label: "Jobs" },
  { href: "/estimates", label: "Estimates" },
  { href: "/comms",     label: "Comms" },
  { href: "/dispatch",  label: "Dispatch" },
  { href: "/reports",   label: "Reports" },
];

export function Nav({ userEmail, isTech }: { userEmail: string | null; isTech?: boolean }) {
  const showAdmin = isAdmin(userEmail);
  return (
    <nav className="sticky top-0 z-30 border-b border-neutral-200 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 md:px-6">
        <Link href="/" className="shrink-0" aria-label="TPAR-DB home">
          <Wordmark size="md" />
        </Link>
        <ul className="ml-2 flex flex-1 items-center gap-1 overflow-x-auto text-sm">
          {isTech ? (
            <li>
              <Link
                href="/me"
                className="inline-block whitespace-nowrap rounded-md bg-emerald-50 px-3 py-1.5 font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200 transition hover:bg-emerald-100"
              >
                My day
              </Link>
            </li>
          ) : null}
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="inline-block whitespace-nowrap rounded-md px-3 py-1.5 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
              >
                {item.label}
              </Link>
            </li>
          ))}
          {showAdmin ? (
            <li>
              <Link
                href="/admin"
                className="inline-block whitespace-nowrap rounded-md bg-accent-50 px-3 py-1.5 font-medium text-accent-700 ring-1 ring-inset ring-accent-100 transition hover:bg-accent-100"
              >
                Admin
              </Link>
            </li>
          ) : null}
        </ul>
        <Link
          href="/search"
          className="hidden whitespace-nowrap rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-50 sm:inline-flex sm:items-center sm:gap-1.5"
          prefetch={false}
          aria-label="Search"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-70">
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
            <path d="M14 14l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>Search</span>
        </Link>
        {userEmail ? (
          <div className="flex items-center gap-3 text-sm text-neutral-600">
            <span className="hidden truncate md:inline" title={userEmail}>
              {userEmail.replace("@tulsapar.com", "")}
            </span>
            <form action="/auth/signout" method="POST">
              <button
                type="submit"
                className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
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
