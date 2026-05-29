// Top nav for the unified TPAR app — Tulsa-flag styled (gold banner, navy text,
// red logo dropdown, flag-ribbon trim).
// Desktop (md+): gold horizontal banner with all links.
// Mobile (< md): logo-menu + hamburger drawer (MobileNavMenu).

import Link from "next/link";
import { LogoMenu } from "./LogoMenu";
import { MobileNavMenu } from "./MobileNavMenu";

// Full nav set — used by the logo dropdown + mobile drawer (not the banner row).
const NAV_ITEMS = [
  { href: "/",          label: "Home" },
  { href: "/time",      label: "Time" },
  { href: "/customers", label: "Customers" },
  { href: "/jobs",      label: "Jobs" },
  { href: "/estimates", label: "Estimates" },
  { href: "/comms",     label: "Comms" },
  { href: "/dispatch",  label: "Dispatch" },
  { href: "/schedule",  label: "Schedule" },
  { href: "/shopping",  label: "Shopping" },
  { href: "/reports",   label: "Reports" },
];

// The few daily-driver links shown directly on the desktop banner. Everything
// else (Home, Time, Shopping, Reports, tools, leadership, admin) lives in the
// logo dropdown, so the banner stays clean instead of overflowing.
const PRIMARY_ITEMS = [
  { href: "/customers", label: "Customers" },
  { href: "/jobs",      label: "Jobs" },
  { href: "/estimates", label: "Estimates" },
  { href: "/comms",     label: "Comms" },
  { href: "/dispatch",  label: "Dispatch" },
  { href: "/schedule",  label: "Schedule" },
];

const TOOL_ITEMS = [
  { href: "/price", label: "Price" },
  { href: "/ask",   label: "Ask" },
  { href: "/voice-notes", label: "Voice" },
  { href: "/whiteboard", label: "Board" },
  { href: "/inbox", label: "Inbox" },
];

// Visible to admin + manager + production_manager — leadership review surfaces.
const LEADERSHIP_ITEMS = [
  { href: "/attach",          label: "Attach" },
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

// The flag-ribbon trim under the banner — repeating gold/cream/navy/red bands,
// echoing the flowing bands of the Tulsa flag.
const RIBBON =
  "repeating-linear-gradient(90deg, #e8a200 0 16px, #f7f2e4 16px 20px, #16335c 20px 34px, #c8102e 34px 38px, #f7f2e4 38px 42px)";

export function Nav({
  userEmail,
  isTech,
  isAdmin: showAdmin = false,
  isManager = false,
  hasTechRow = false,
  unreadInbox = 0,
  unreadBoard = 0,
}: {
  userEmail: string | null;
  isTech?: boolean;
  isAdmin?: boolean;
  isManager?: boolean;
  hasTechRow?: boolean;
  unreadInbox?: number;
  unreadBoard?: number;
}) {
  const badgeFor = (href: string): number =>
    href === "/inbox" ? unreadInbox : href === "/whiteboard" ? unreadBoard : 0;
  const showMyDay = isTech || hasTechRow;

  // Build the section list once — shared by the logo dropdown + mobile drawer.
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
      items: TOOL_ITEMS.map((i) => ({ ...i, tone: "default" as const, badge: badgeFor(i.href) || undefined })),
    },
    ...(showAdmin || isManager
      ? [{ title: "Leadership", items: LEADERSHIP_ITEMS.map((i) => ({ ...i, tone: "admin" as const })) }]
      : []),
    ...(showAdmin
      ? [{ title: "Admin", items: ADMIN_ITEMS.map((i) => ({ ...i, tone: "admin" as const })) }]
      : []),
    ...(isManager
      ? [{ title: "Role", items: [{ href: "/me", label: "Manager · read-only", tone: "manager" as const }] }]
      : []),
    {
      title: "Other",
      items: [{ href: "/search", label: "Search", tone: "default" as const }],
    },
  ];

  return (
    <nav className="sticky top-0 z-30 bg-gold-500 shadow-sm">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-3 py-2.5 md:gap-4 md:px-6 md:py-3">
        {/* Logo doubles as the full-app menu (red dropdown). */}
        <LogoMenu sections={mobileSections} />

        {/* Desktop banner — a few daily-driver links; everything else lives in
            the logo dropdown (left), so the banner stays clean. */}
        <ul className="ml-2 hidden flex-1 items-center gap-1.5 text-sm md:flex">
          {showMyDay ? (
            <li>
              <Link
                href="/me"
                className="inline-block whitespace-nowrap rounded-md bg-navy-800 px-3 py-1.5 font-medium text-white ring-1 ring-inset ring-navy-900/40 transition hover:bg-navy-900"
              >
                My day
              </Link>
            </li>
          ) : null}
          {PRIMARY_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="inline-block whitespace-nowrap rounded-md px-3 py-1.5 font-medium text-navy-900 transition hover:bg-gold-400"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* Mobile spacer pushes hamburger + email to the right */}
        <div className="ml-auto md:hidden" />

        {/* Search button */}
        <Link
          href="/search"
          className="hidden whitespace-nowrap rounded-md border border-navy-900/20 bg-white/90 px-3 py-1.5 text-sm text-navy-900 transition hover:bg-white sm:inline-flex sm:items-center sm:gap-1.5"
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
          <div className="hidden items-center gap-3 text-sm text-navy-900 md:flex">
            <span className="hidden truncate md:inline" title={userEmail}>
              {userEmail.replace("@tulsapar.com", "")}
            </span>
            <form action="/auth/signout" method="POST">
              <button
                type="submit"
                className="rounded-md border border-navy-900/20 bg-white/90 px-2.5 py-1 text-xs font-medium text-navy-900 transition hover:bg-white"
              >
                Sign out
              </button>
            </form>
          </div>
        ) : null}

        {/* Mobile hamburger — hidden on md+ */}
        <MobileNavMenu sections={mobileSections} userEmail={userEmail} />
      </div>

      {/* Flag-ribbon trim */}
      <div aria-hidden="true" className="h-1.5 w-full" style={{ backgroundImage: RIBBON }} />
    </nav>
  );
}
