"use client";

// Desktop banner links with active-page highlighting. Nav.tsx is a server
// component with no pathname awareness, so the "active" pill is computed here.
// The highlight follows the current page; "My day" is a distinct tech CTA that
// only takes the active (dark) treatment when you're actually on /me.

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string };

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

const ACTIVE = "bg-navy-800 text-white ring-1 ring-inset ring-navy-900/40";
const IDLE = "text-navy-900 hover:bg-gold-400";
const MYDAY_IDLE = "bg-navy-800/10 text-navy-900 ring-1 ring-inset ring-navy-900/20 hover:bg-navy-800/20";

export function NavLinks({ showMyDay, items }: { showMyDay: boolean; items: Item[] }) {
  const pathname = usePathname() || "/";
  return (
    <ul className="ml-2 hidden flex-1 items-center gap-1.5 text-sm md:flex">
      {showMyDay ? (
        <li>
          <Link
            href="/me"
            className={`inline-block whitespace-nowrap rounded-md px-3 py-1.5 font-medium transition ${isActive(pathname, "/me") ? ACTIVE : MYDAY_IDLE}`}
          >
            My day
          </Link>
        </li>
      ) : null}
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            className={`inline-block whitespace-nowrap rounded-md px-3 py-1.5 font-medium transition ${isActive(pathname, item.href) ? ACTIVE : IDLE}`}
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
