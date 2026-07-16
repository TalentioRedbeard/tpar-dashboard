// Photo gallery (Danny 2026-06-15). A filterable thumbnail gallery for a job, a
// customer, an estimate, or all segments of a project. Reached by an "📷 Photos" link
// from the job/customer pages. Photos come from Google Drive (reusing getJobMedia via
// lib/gallery-actions). Tech-scoped: a tech can view photos for jobs they were on;
// customer/estimate scopes (which span jobs) are office-only.

import { PageShell } from "../../components/PageShell";
import { GalleryGrid } from "../../components/GalleryGrid";
import { GalleryFilter } from "../../components/GalleryFilter";
import { getCurrentTech } from "../../lib/current-tech";
import { db } from "@/lib/supabase";
import { assignedHasEmployee } from "@/lib/assigned-employees";
import { techWorkedJob } from "@/lib/tech-scope";
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

  // Top-nav "Gallery" lands here with no scope/id → show the chooser (search a job/customer).
  if (!id) {
    return (
      <PageShell
        kicker="Gallery"
        title="Photos"
        description={<span className="text-sm text-neutral-600">Find a job or customer to view their photos.</span>}
        backHref="/"
        backLabel="Home"
      >
        <GalleryFilter isOffice={isOffice} />
      </PageShell>
    );
  }

  // Resolve a friendly title + cross-links + (for techs) the job-scope auth check.
  let title = "Photos";
  let customerId: string | null = null;
  let backHref = "/jobs";
  let unauthorized: string | null = null;

  if (!id) {
    unauthorized = "No subject specified. Open a gallery from a job or customer page.";
  } else if (scope === "job" || scope === "segment") {
    const { data } = await db()
      .from("jobs_master")
      .select("customer_name, hcp_customer_id, assigned_employees")
      .eq("hcp_job_id", id)
      .maybeSingle();
    const row = data as { customer_name?: string | null; hcp_customer_id?: string | null; assigned_employees?: string | null } | null;
    customerId = row?.hcp_customer_id ?? null;
    title = `Photos · ${row?.customer_name ?? "job"}`;
    backHref = `/job/${id}`;
    // Tech scope: a tech may view photos for any job they were on — full
    // history, crew counts (canonical rule, lib/tech-scope.ts: job record OR
    // appointment crew by hcp_employee_id). Deny if unverifiable.
    if (!isOffice) {
      const onJob = assignedHasEmployee(row?.assigned_employees ?? null, me.tech?.hcp_employee_id ?? null)
        || await techWorkedJob(me.tech?.hcp_employee_id, id);
      if (!onJob) unauthorized = "You can only view photos for jobs you were on.";
    }
  } else if (scope === "customer") {
    if (!isOffice) unauthorized = "Customer-wide photo history is office-only.";
    else {
      // Entity-aware title: a customer scope spans the whole tethered entity (e.g. Brad
      // Dunlap = 25 Dunlap Properties records), so name it from the entity, not the one id.
      const { data: members } = await db().rpc("customer_entity_members", { p_seed: id });
      const mrows = (members ?? []) as Array<{ member_cid: string; member_name: string | null }>;
      const mnames = mrows.map((r) => r.member_name).filter((x): x is string => !!x);
      let entLabel: string | null = mnames.filter((x) => !/^\d/.test(x)).sort((a, b) => a.length - b.length)[0]
        ?? mnames.sort((a, b) => a.length - b.length)[0] ?? null;
      if (!entLabel && mrows.length) {
        const { data: jn } = await db().from("jobs_master").select("customer_name")
          .in("hcp_customer_id", mrows.map((r) => r.member_cid).filter((x): x is string => !!x)).not("customer_name", "is", null).limit(1).maybeSingle();
        entLabel = (jn as { customer_name?: string } | null)?.customer_name ?? null;
      }
      const memberCount = mrows.length || 1;
      title = `Photos · ${entLabel ?? "customer"}${memberCount > 1 ? ` · ${memberCount} records` : ""}`;
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
      description={<span className="text-sm text-neutral-600">Photos from Housecall Pro, Slack #job-media, and in-app uploads · tap to view full-size, check to multi-select.</span>}
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
