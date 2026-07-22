// Photo gallery (Danny 2026-06-15). A filterable thumbnail gallery for a job, a
// customer, an estimate, or all segments of a project. Reached by an "📷 Photos" link
// from the job/customer pages. Photos come from Google Drive (reusing getJobMedia via
// lib/gallery-actions). Tech-scoped: a tech can view photos for jobs they were on;
// customer/estimate scopes (which span jobs) are office-only.

import { PageShell } from "../../components/PageShell";
import { GalleryGrid } from "../../components/GalleryGrid";
import { GalleryFilter } from "../../components/GalleryFilter";
import { GalleryUploadPanel } from "../../components/GalleryUploadPanel";
import { getRecentJobs, type RecentJobOption } from "../photos/actions";
import { getCurrentState as getClockState, type CurrentClockState } from "../time/actions";
import { ReceiptsBrowser } from "../../components/ReceiptsBrowser";
import { getCurrentTech } from "../../lib/current-tech";
import { searchReceipts } from "../../lib/receipt-browse-actions";
import { listPurchaserOptions } from "../../lib/purchasers";
import { db } from "@/lib/supabase";
import { assignedHasEmployee } from "@/lib/assigned-employees";
import { techWorkedJob } from "@/lib/tech-scope";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const SCOPES = ["job", "customer", "estimate", "segment"] as const;
type Scope = (typeof SCOPES)[number];

export default async function GalleryPage({ searchParams }: { searchParams: Promise<{ scope?: string; id?: string; cat?: string }> }) {
  const sp = await searchParams;
  const scope = (SCOPES.includes(sp.scope as Scope) ? (sp.scope as Scope) : "job");
  const id = (sp.id ?? "").trim();
  const cat = (sp.cat ?? "").trim();

  const me = await getCurrentTech().catch(() => null);
  if (!me) redirect(`/login?from=${encodeURIComponent(`/gallery?scope=${scope}&id=${id}`)}`);
  const isOffice = !!(me.isAdmin || me.isManager);

  // Gallery-framework Phase 1: the Receipts tile — office-only (financial
  // data; same gate class as /reports). Built standalone against
  // receipts_master; Phase 2 folds it behind the union RPC unchanged.
  if (cat === "receipts") {
    if (!isOffice) redirect("/gallery");
    const [initial, purchasers] = await Promise.all([
      searchReceipts({ category: "all" }),
      listPurchaserOptions().catch(() => []),
    ]);
    return (
      <PageShell
        kicker="Gallery"
        title="Receipts"
        description="Every receipt in one searchable ledger — filter by time, job, customer, category, or who filed it; fix the purchaser inline."
        backHref="/gallery"
        backLabel="Gallery"
        help={{
          intent: "The is-everything-accounted-for view: search and total every receipt, and correct who it's attributed to.",
          actions: [
            "Filter by vendor text, time window, category chips, person, job #, customer, or amount range.",
            "The total updates with your filters — that's the verification number.",
            "Click the purchaser name to reassign a receipt (audited).",
            "Unattributed chip = the reconcile backlog; the queue page has the attach-to-job verbs.",
          ],
          stuck: <>Batch-imported receipts (email/statement) have no photo and often no person — that&apos;s the source data, not a bug.</>,
        }}
      >
        {initial.ok ? (
          <ReceiptsBrowser purchasers={purchasers} initial={{ rows: initial.rows, totalCount: initial.totalCount, totalAmount: initial.totalAmount, pageSize: initial.pageSize }} />
        ) : (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{initial.error}</div>
        )}
      </PageShell>
    );
  }

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
        {me.canWrite ? (
          <div className="mb-4">
            <Link href="/photos"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700">
              📷 Take or add a photo →
            </Link>
          </div>
        ) : null}
        {isOffice ? (
          <div className="mb-4">
            <Link href="/gallery?cat=receipts"
              className="inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800 hover:bg-brand-100">
              🧾 Receipts — search &amp; verify every receipt →
            </Link>
          </div>
        ) : null}
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

  // Upload/take-a-photo affordance — the job gallery must let a tech ADD a photo,
  // not just view (Danny 2026-07-22). Reuses the /photos pipeline, pre-scoped to
  // this job. Only when the viewer can write + is authorized for the job.
  const isJobScope = scope === "job" || scope === "segment";
  let uploadProps: { recentJobs: RecentJobOption[]; clockedJobId: string | null } | null = null;
  if (isJobScope && !unauthorized && me.canWrite) {
    const [recentJobs, clockState] = await Promise.all([
      getRecentJobs({ limit: 30 }).catch(() => [] as RecentJobOption[]),
      me.tech ? getClockState().catch(() => null) : Promise.resolve(null),
    ]);
    const clockedJobId = clockState && clockState.state === "clocked-in"
      ? (clockState as Extract<CurrentClockState, { state: "clocked-in" }>).hcp_job_id
      : null;
    uploadProps = { recentJobs, clockedJobId };
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
      {uploadProps ? (
        <GalleryUploadPanel
          canWrite={me.canWrite}
          recentJobs={uploadProps.recentJobs}
          defaultJobId={id}
          clockedJobId={uploadProps.clockedJobId}
        />
      ) : null}

      {isJobScope && !unauthorized ? (
        <details className="mb-4 rounded-xl border border-neutral-200 bg-white p-3">
          <summary className="cursor-pointer select-none text-sm font-medium text-neutral-700">🔍 Find another job&rsquo;s photos</summary>
          <div className="mt-3"><GalleryFilter isOffice={isOffice} /></div>
        </details>
      ) : null}

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
