// /admin/view-as — pick a tech to impersonate for dashboard preview.
//
// Per Danny 2026-05-04: leadership (Danny, Kelsey, Madisson) wants to see
// the scope-limited tech dashboard architecture so they can offer guidance.
// Admin/manager only.

import { redirect } from "next/navigation";
import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { setViewAsTech, clearViewAsTech } from "./actions";

export const dynamic = "force-dynamic";

export default async function ViewAsPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/admin/view-as");
  if (!me.isAdmin && !me.isManager && me.realRole !== "admin" && me.realRole !== "manager" && me.realRole !== "production_manager") {
    return (
      <PageShell title="Admin only" description="View-as is for leadership review.">
        <EmptyState title="Not authorized." />
      </PageShell>
    );
  }

  const supa = db();
  const { data: techs } = await supa
    .from("tech_directory")
    .select("tech_short_name, hcp_full_name, dashboard_role, is_lead, is_active")
    .eq("is_active", true)
    .order("dashboard_role", { ascending: true })
    .order("tech_short_name", { ascending: true });

  return (
    <PageShell
      kicker="Admin"
      title="View as tech"
      description={
        <span>
          Step into another tech's dashboard view (read what they read).
          Useful for previewing the scope-limited architecture.
          {me.isImpersonating ? (
            <> · <span className="text-amber-700">Currently viewing as <strong>{me.tech?.tech_short_name}</strong></span></>
          ) : null}
        </span>
      }
    >
      {me.isImpersonating ? (
        <Section title="Currently impersonating">
          <form action={clearViewAsTech}>
            <button
              type="submit"
              className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700"
            >
              Exit view-as ({me.tech?.tech_short_name}) →
            </button>
          </form>
        </Section>
      ) : null}

      <Section
        title="Pick a tech to view as"
        description="Click to step into their dashboard. The whole UI re-renders as if they were signed in. Auth tier downgrades to tech, scope limits apply, change-write actions still record under your real email."
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {(techs ?? []).map((t: any) => (
            <form key={t.tech_short_name} action={setViewAsTech}>
              <input type="hidden" name="tech_short_name" value={t.tech_short_name} />
              <button
                type="submit"
                className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-white p-3 text-left shadow-sm transition hover:border-brand-300 hover:bg-brand-50"
              >
                <div>
                  <div className="font-medium text-neutral-900">{t.tech_short_name}</div>
                  <div className="text-xs text-neutral-500">
                    {t.hcp_full_name ?? "—"}
                    {t.dashboard_role ? <> · role: {t.dashboard_role}</> : null}
                    {t.is_lead ? " · lead" : ""}
                  </div>
                </div>
                <span className="rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700">View →</span>
              </button>
            </form>
          ))}
        </div>
      </Section>

      <div className="mt-8 rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4 text-xs text-neutral-600">
        <div className="font-medium text-neutral-700">How this works</div>
        <ul className="mt-1 list-disc pl-5 leading-relaxed">
          <li>Click a tech → cookie set, you're rendered as them throughout the app</li>
          <li>Banner stays visible at the top reminding you you're impersonating</li>
          <li>Click "Exit view-as" to return to your real account</li>
          <li>Cookie expires after 8 hours automatically</li>
          <li>Mutating actions (notes, enrollments, etc.) still record under your real email — so you can test write flows without polluting attribution</li>
        </ul>
      </div>
    </PageShell>
  );
}
