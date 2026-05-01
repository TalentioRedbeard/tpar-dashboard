// Admin index. Phase 3 Tier 3 — Danny-only by default.

import Link from "next/link";
import { redirect } from "next/navigation";
import { PageShell } from "../../components/PageShell";
import { getSessionUser } from "../../lib/supabase-server";
import { isAdmin } from "../../lib/admin";

export const metadata = { title: "Admin · TPAR-DB" };

const SECTIONS = [
  {
    href: "/admin/techs",
    title: "Tech directory",
    desc: "Edit slack_user_id, active flag, and notes per tech. Affects Slack routing across the system.",
  },
  {
    href: "/admin/dev-log",
    title: "Dev log",
    desc: "Nightly narrative of TPAR development — what shipped, what's open, what we decided. Compaction of last 24h maintenance_logs via Haiku.",
  },
];

export default async function AdminIndexPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");

  return (
    <PageShell
      title="Admin"
      description="Phase 3 Tier 3 — restricted writes. Every edit is logged to maintenance_logs."
    >
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="group block rounded-2xl border border-neutral-200 bg-white p-5 transition-all duration-150 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md"
            >
              <h3 className="text-base font-semibold tracking-tight text-neutral-900 transition-colors group-hover:text-brand-700">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-neutral-600">{s.desc}</p>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
