// Top nav for the unified TPAR app.
// Desktop (md+): full horizontal nav with all links pill-styled.
// Mobile (< md): logo + hamburger drawer (MobileNavMenu) — fixes the
// horizontal-scroll cut-off Danny hit 2026-05-04.

import Link from "next/link";
import { Wordmark } from "./ui/Brand";
import { MobileNavMenu } from "./MobileNavMenu";

const NAV_ITEMS = [
  { href: "/",          label: "Today" },
  { href: "/time",      label: "Time" },
  { href: "/customers", label: "Customers" },
  { href: "/jobs",      label: "Jobs" },
  { href: "/estimates", label: "Estimates" },
  { href: "/comms",     label: "Comms" },
  { href: "/dispatch",  label: "Dispatch" },
  { href: "/shopping",  label: "Shopping" },
  { href: "/reports",   label: "Reports" },
];

const TOOL_ITEMS = [
  { href: "/price", label: "Price" },
  { href: "/ask",   label: "Ask" },
  { href: "/voice-notes", label: "Voice" },
];

// Visible to admin + manager + production_manager — leadership review surfaces.
// View-as: leadership previews tech dashboard. SalesAsk: binding review.
// Catalog: every system surface (auto-generated).
const LEADERSHIP_ITEMS = [
  { href: "/admin/leads",     label: "Leads" },
  { href: "/admin/view-as",   label: "View as" },
  { href: "/admin/concerns",  label: "Concerns" },
  { href: "/admin/salesask",  label: "SalesAsk" },
  { href: "/admin/catalog",   label: "Catalog" },
];

// Admin-only — Danny tools (alarms / laptop snap / admin index page).
const ADMIN_ITEMS = [
  { href: "/alarms",          label: "Alarms" },
  { href: "/snap",            label: "Snap" },
  { href: "/admin",           label: "Admin home" },
];

export function Nav({
  userEmail,
  isTech,
  isAdmin: showAdmin = false,
  isManager = false,
  hasTechRow = false,
}: {
  userEmail: string | null;
  isTech?: boolean;
  isAdmin?: boolean;
  isManager?: boolean;
  hasTechRow?: boolean;
}) {
  // Show "My day" link to anyone with a tech_directory row, regardless of
  // dashboard role. Admins (Danny, Kelsey) can intentionally visit /me without
  // being forced there.
  const showMyDay = isTech || hasTechRow;
  // Build the section list once for the mobile drawer
  const mobileSections = [
    {
      title: "Main",
      items: [
        ...(showMyDay ? [{ href: "/me", label: "My day", tone: "tech" as const }] : []),
        ...NAV_ITEMS.map((i) => ({ ...i, tone: "default" as const })),
      ],
    },
    {
      title: "Tools",
      items: TOOL_ITEMS.map((i) => ({ ...i, tone: "default" as const })),
    },
    ...(showAdmin || isManager
      ? [{
          title: "Leadership",
          items: LEADERSHIP_ITEMS.map((i) => ({ ...i, tone: "admin" as const })),
        }]
      : []),
    ...(showAdmin
      ? [{
          title: "Admin",
          items: ADMIN_ITEMS.map((i) => ({ ...i, tone: "admin" as const })),
        }]
      : []),
    ...(isManager
      ? [{
          title: "Role",
          items: [{ href: "/me", label: "Manager · read-only", tone: "manager" as const }],
        }]
      : []),
    {
      title: "Other",
      items: [{ href: "/search", label: "Search", tone: "default" as const }],
    },
  ];

  return (
    <nav className="sticky top-0 z-30 border-b border-neutral-200/80 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-3 py-2.5 md:gap-4 md:px-6 md:py-3">
        <Link href="/" className="shrink-0" aria-label="TPAR-DB home">
          <Wordmark size="md" />
        </Link>

        {/* Desktop horizontal nav — hidden on phones */}
        <ul className="ml-2 hidden flex-1 items-center gap-1 overflow-x-auto text-sm md:flex">
          {showMyDay ? (
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
          <li className="mx-1 h-5 w-px bg-neutral-200" aria-hidden="true" />
          {TOOL_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="inline-block whitespace-nowrap rounded-md px-3 py-1.5 text-neutral-600 transition hover:bg-brand-50 hover:text-brand-700"
              >
                {item.label}
              </Link>
            </li>
          ))}
          {/* Leadership items visible to admin OR manager (View as / SalesAsk) */}
          {(showAdmin || isManager) ? (
            <>
              {LEADERSHIP_ITEMS.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="inline-block whitespace-nowrap rounded-md px-3 py-1.5 text-accent-700 transition hover:bg-accent-50"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </>
          ) : null}
          {showAdmin ? (
            <>
              {ADMIN_ITEMS.slice(0, 2).map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="inline-block whitespace-nowrap rounded-md px-3 py-1.5 text-accent-700 transition hover:bg-accent-50"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/admin"
                  className="inline-block whitespace-nowrap rounded-md bg-accent-50 px-3 py-1.5 font-medium text-accent-700 ring-1 ring-inset ring-accent-100 transition hover:bg-accent-100"
                >
                  Admin
                </Link>
              </li>
            </>
          ) : null}
          {isManager ? (
            <li
              title="Manager — full read access; writes are admin-only."
              className="inline-block whitespace-nowrap rounded-md bg-brand-50 px-3 py-1.5 font-medium text-brand-700 ring-1 ring-inset ring-brand-200"
            >
              Manager · read-only
            </li>
          ) : null}
        </ul>

        {/* Mobile spacer pushes hamburger + email to the right */}
        <div className="ml-auto md:hidden" />

        {/* Search button — hidden on the smallest mobile to save space */}
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

        {/* Desktop email + sign-out */}
        {userEmail ? (
          <div className="hidden items-center gap-3 text-sm text-neutral-600 md:flex">
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

        {/* Mobile hamburger — hidden on md+ */}
        <MobileNavMenu sections={mobileSections} userEmail={userEmail} />
      </div>
    </nav>
  );
}
