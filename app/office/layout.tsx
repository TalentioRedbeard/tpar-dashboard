// TPAR Office — the CFO/back-office surface (plan 2026-07-15). Owner-only:
// the layout gates rendering, and every server action in lib/office/
// self-authorizes with requireOwner() besides (never trust a layout alone —
// gallery-lane law). View-as never passes an owner gate by construction.

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/current-tech";

export const dynamic = "force-dynamic";
export const metadata = { title: "TPAR Office" };

const TABS = [
  { href: "/office", label: "Obligations" },
  { href: "/office/vault", label: "Vault" },
  { href: "/office/entity", label: "Entity & Coverage" },
];

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const gate = await requireOwner();
  if (!gate.ok) redirect("/");

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6 rounded-2xl border border-navy-200 bg-white p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">TPAR Office</div>
        <h1 className="text-2xl font-bold text-navy-900">The back office, watched</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Obligations, documents, licenses, coverage, and the handoff — QuickBooks stays the books;
          this keeps the record and the calendar honest.
        </p>
        <nav className="mt-4 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="rounded-full bg-neutral-100 px-4 py-1.5 text-sm font-medium text-navy-900 hover:bg-brand-100"
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}
