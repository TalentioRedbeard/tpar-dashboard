// Top nav for the unified TPAR app — Tulsa-flag styled (gold banner, navy text,
// red logo dropdown, flag-ribbon trim).
// Desktop (md+): gold horizontal banner with all links.
// Mobile (< md): logo-menu + hamburger drawer (MobileNavMenu).

import Link from "next/link";
import { LogoMenu } from "./LogoMenu";
import { MobileNavMenu } from "./MobileNavMenu";
import { NavLinks } from "./NavLinks";
import { FlagRibbon } from "./FlagRibbon";
import { CenterBrand } from "./ui/CenterBrand";

// Full nav set — used by the logo dropdown + mobile drawer (not the banner row).
// Each item carries an emoji icon shown in the dropdown (Danny 2026-06-20). Swap
// the emoji map for an inline-SVG icon set later if a crisper look is wanted.
const NAV_ITEMS = [
  { href: "/",          label: "Home",      icon: "🏠" },
  { href: "/time",      label: "Time",      icon: "⏱️" },
  { href: "/customers", label: "Customers", icon: "👥" },
  { href: "/jobs",      label: "Jobs",      icon: "🔧" },
  { href: "/estimates", label: "Estimates", icon: "📄" },
  { href: "/comms",     label: "Comms",     icon: "💬" },
  { href: "/contacts",  label: "Contacts",  icon: "📇" },
  { href: "/dispatch",  label: "Dispatch",  icon: "🗺️" },
  { href: "/schedule",  label: "Schedule",  icon: "📅" },
  { href: "/gallery",   label: "Gallery",   icon: "🖼️" },
  { href: "/shopping",  label: "Shopping",  icon: "🛒" },
  { href: "/reports",   label: "Reports",   icon: "📊" },
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
  { href: "/gallery",   label: "Gallery" },
];

// Tech banner — the daily-driver destinations a field tech gets. Each renders a
// tech-scoped "what pertains to me" view (own work, financials redacted), plus
// Shopping and the field guide.
const TECH_PRIMARY_ITEMS = [
  { href: "/jobs",      label: "Jobs" },
  { href: "/customers", label: "Customers" },
  { href: "/estimates", label: "Estimates" },
  { href: "/schedule",  label: "Schedule" },
  { href: "/comms",     label: "Comms" },
  { href: "/gallery",   label: "Gallery" },
  { href: "/shopping",  label: "Shopping" },
  { href: "/how-to",    label: "How-to" },
];

const TOOL_ITEMS = [
  { href: "/price", label: "Price", icon: "🏷️" },
  { href: "/ask",   label: "Ask", icon: "✨" },
  { href: "/voice-notes", label: "Voice", icon: "🎙️" },
  { href: "/whiteboard", label: "Board", icon: "📝" },
  { href: "/inbox", label: "Inbox", icon: "📥" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
  { href: "/training", label: "Training", icon: "🎓" },
  { href: "/how-to", label: "How to use the app", icon: "❔" },
];

// Visible to admin + manager + production_manager — leadership review surfaces.
// (SalesAsk removed 2026-06-20 — integration retired; route left in place.)
const LEADERSHIP_ITEMS = [
  { href: "/studio",          label: "Studio", icon: "🎬" },
  { href: "/attach",          label: "Attach", icon: "📧" },
  { href: "/admin/leads",     label: "Leads", icon: "🎯" },
  { href: "/campaigns/review", label: "Campaigns", icon: "📣" },
  { href: "/admin/view-as",   label: "View as", icon: "🕵️" },
  { href: "/admin/concerns",  label: "Concerns", icon: "⚠️" },
  { href: "/admin/catalog",   label: "Catalog", icon: "🧭" },
];

// Admin-only — Danny tools (alarms / laptop snap / admin index page).
const ADMIN_ITEMS = [
  { href: "/owner",              label: "Owner Control", icon: "🎛️" },
  { href: "/conversation",       label: "Conversation", icon: "💬" },
  { href: "/context",            label: "Context", icon: "🤝" },
  { href: "/bom",                label: "Service BOMs", icon: "🔧" },
  { href: "/admin/expectations", label: "Expectations", icon: "✅" },
  { href: "/admin/integrations", label: "Integrations", icon: "🔌" },
  { href: "/alarms",          label: "Alarms", icon: "⏰" },
  { href: "/snap",            label: "Snap", icon: "📸" },
  { href: "/admin",           label: "Admin home", icon: "🛡️" },
];

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
  // Leadership-only surfaces (company-wide revenue/margins/all customers+comms).
  // Techs are page-gated to /me on these; hide the links too so the nav honors
  // "you only see your own work". Scoped object pages (/job/[id], /customer/[id])
  // stay reachable. /schedule, /comms, /jobs, /customers, /estimates all render
  // tech-scoped views (own work, financials redacted), so they are NOT
  // leadership-gated — only /dispatch and /reports stay leadership-only.
  const leadershipView = showAdmin || isManager;
  const LEADERSHIP_LIST = new Set(["/dispatch", "/reports"]);
  const navItems = leadershipView ? NAV_ITEMS : NAV_ITEMS.filter((i) => !LEADERSHIP_LIST.has(i.href));
  const primaryItems = leadershipView ? PRIMARY_ITEMS : TECH_PRIMARY_ITEMS;

  // Build the section list once — shared by the logo dropdown + mobile drawer.
  const mobileSections = [
    {
      title: "Main",
      items: [
        ...(showMyDay ? [{ href: "/me", label: "My day", icon: "☀️", tone: "tech" as const }] : []),
        ...navItems.map((i) => ({ ...i, tone: "default" as const })),
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
      ? [{ title: "Role", items: [{ href: "/me", label: "Manager · read-only", icon: "👁️", tone: "manager" as const }] }]
      : []),
    ...(leadershipView
      ? [{
          title: "Other",
          items: [{ href: "/search", label: "Search", icon: "🔎", tone: "default" as const }],
        }]
      : []),
  ];

  return (
    <nav className="sticky top-0 z-50 bg-gold-500 shadow-sm">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-3 py-2.5 md:gap-4 md:px-6 md:py-3">
        {/* Logo doubles as the full-app menu (red dropdown). */}
        <LogoMenu sections={mobileSections} />

        {/* Desktop banner — a few daily-driver links; everything else lives in
            the logo dropdown (left), so the banner stays clean. Active-page
            highlight is computed client-side in NavLinks (usePathname). */}
        <NavLinks showMyDay={showMyDay} items={primaryItems} />

        {/* Centered company identity — sits in the empty gap between the links
            and the right-side actions (md+ acts as the flex spacer; the wordmark
            shows on lg+). Replaces the old dead-center overlay that collided
            with the nav links. */}
        <CenterBrand />

        {/* Mobile spacer pushes hamburger + email to the right */}
        <div className="ml-auto md:hidden" />

        {/* How-to guide — opens the field guide in a new tab. Always visible
            (icon-only on mobile) since field techs are mobile-first. */}
        <a
          href="/how-to"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-navy-900/20 bg-white/90 px-2.5 py-1.5 text-sm text-navy-900 transition hover:bg-white"
          title="How to use this app (opens in a new tab)"
          aria-label="How to use this app"
        >
          <span aria-hidden>❔</span>
          <span className="hidden sm:inline">How to use</span>
        </a>

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
            <Link
              href="/settings"
              className="hidden truncate rounded-md px-1.5 py-0.5 transition hover:bg-white/60 md:inline"
              title="Your settings"
            >
              {userEmail.replace("@tulsapar.com", "")}
            </Link>
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

      {/* Flag-ribbon trim — flowing Tulsa-flag bands */}
      <FlagRibbon />
    </nav>
  );
}
