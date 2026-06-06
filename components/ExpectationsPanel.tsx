// ExpectationsPanel — the "My day" daily expectations on /me. Renders the
// owner-authored expectations that apply to this employee (global / their role /
// them by name). Guidance, not a hard gate (system invites, never compels).
// Returns null when there are none, so it never adds empty chrome.

import Link from "next/link";
import { listDailyExpectations } from "../lib/expectations";
import type { DashboardRole } from "../lib/current-tech";
import { ScrollPanel } from "./ui/ScrollPanel";

export async function ExpectationsPanel({ techShortName, role }: { techShortName: string | null; role: DashboardRole }) {
  const items = await listDailyExpectations(techShortName, role).catch(() => []);
  if (items.length === 0) return null;

  const body = (
    <ul className="space-y-2">
      {items.map((e) => (
        <li key={e.id} className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3">
          <span className="mt-0.5 text-xl" aria-hidden>{e.icon ?? "•"}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-neutral-900">{e.title}</p>
            {e.detail ? <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">{e.detail}</p> : null}
            {e.link_href ? (
              <Link href={e.link_href} className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">
                {e.link_label ?? "Open"} →
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">🎯 Your day, the basics</h2>
      {items.length > 5 ? <ScrollPanel tier="standard">{body}</ScrollPanel> : body}
    </section>
  );
}
