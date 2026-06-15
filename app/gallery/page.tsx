// Photo gallery (Danny 2026-06-15). A filterable thumbnail gallery for a job, a
// customer, an estimate, or all segments of a project. Reached by an "📷 Photos" link
// from the job/customer pages. Photos come from Google Drive (reusing getJobMedia via
// lib/gallery-actions). Tech-scoped: a tech can view photos for jobs they were on;
// customer/estimate scopes (which span jobs) are office-only.

import { PageShell } from "../../components/PageShell";
import { GalleryGrid } from "../../components/GalleryGrid";
import { getCurrentTech } from "../../lib/current-tech";
import { db } from "@/lib/supabase";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const SCOPES = ["job", "customer", "estimate", "segment"] as const;
type Scope = (typeof SCOPES)[number];

export default async function GalleryPage({ searchParams }: { searchParams: Promise<{ scope?: string; id?: string }> }) {
  const sp = await searchParams;
  const scope = (SCOPES.includes(sp.scope as Scope) ? (sp.scope as Scope) : "job");
  const id = (sp.id ?? "").trim();

  const me = await getCurrentTech().catch(() => null);
  if (!me) redirect(`/login?from=${encodeURIComponent(`/gallery?scope=${scope}&id=${id}`)}`);
  const isOffice = !!(me.isAdmin || me.isManager);

  // Resolve a friendly title + cross-links + (for techs) the job-scope auth check.
  let title = "Photos";
  let customerId: string | null = null;
  let backHref = "/jobs";
  let unauthorized: string | null = null;

  if (!id) {
    unauthorized = "No subject specified. Open a gallery from a job or customer page.";
  } else if (scope === "job" || scope === "segment") {
    const { data } = await db()
      .from("job_360")
      .select("customer_name, hcp_customer_id, tech_primary_name, tech_all_names")
      .eq("hcp_job_id", id)
      .maybeSingle();
    const row = data as { customer_name?: string | null; hcp_customer_id?: string | null; tech_primary_name?: string | null; tech_all_names?: string[] | null } | null;
    customerId = row?.hcp_customer_id ?? null;
    title = `Photos · ${row?.customer_name ?? "job"}`;
    backHref = `/job/${id}`;
    // Tech scope: a tech may only view photos for a job they were on (mirrors /job auth).
    if (!isOffice) {
      const mine = me.tech?.hcp_full_name ?? null;
      const crew = [row?.tech_primary_name, ...((row?.tech_all_names as string[] | null) ?? [])].filter(Boolean) as string[];
      if (!mine || !crew.includes(mine)) unauthorized = "You can only view photos for jobs you were on.";
    }
  } else if (scope === "customer") {
    if (!isOffice) unauthorized = "Customer-wide photo history is office-only.";
    else {
      const { data } = await db().from("customer_360").select("name").eq("hcp_customer_id", id).maybeSingle();
      title = `Photos · ${(data as { name?: string } | null)?.name ?? "customer"}`;
      backHref = `/customer/${id}`;
    }
  } else if (scope === "estimate") {
    if (!isOffice) unauthorized = "Estimate photos are office-only.";
    else { title = "Photos · estimate"; }
  }

  // Filter tabs (the "filterable options"). Only show what we can target.
  const tabs: Array<{ label: string; scope: Scope; id: string }> = [];
  if (scope === "job" || scope === "segment") {
    tabs.push({ label: "This job", scope: "job", id });
    if (customerId && isOffice) tabs.push({ label: "All for this customer", scope: "customer", id: customerId });
  } else if (scope === "customer") {
    tabs.push({ label: "Customer", scope: "customer", id });
  } else if (scope === "estimate") {
    tabs.push({ label: "Estimate", scope: "estimate", id });
  }

  return (
    <PageShell
      kicker="Gallery"
      title={title}
      description={<span className="text-sm text-neutral-600">Thumbnails from Google Drive · tap to view full-size, check to multi-select.</span>}
      backHref={backHref}
      backLabel="Back"
    >
      {tabs.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {tabs.map((t) => {
            const active = t.scope === scope && t.id === id;
            return (
              <Link
                key={`${t.scope}:${t.id}`}
                href={`/gallery?scope=${t.scope}&id=${encodeURIComponent(t.id)}`}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${active ? "bg-brand-600 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      ) : null}

      {unauthorized ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">{unauthorized}</div>
      ) : (
        <GalleryGrid scope={scope} id={id} />
      )}
    </PageShell>
  );
}
