// Estimate detail page — view the record and edit a few key fields (status,
// project name). Line-item edits still live in HCP; "Open in HCP" links out
// for those. Built so every row in /estimates can deep-link here regardless
// of whether the estimate has a linked hcp_job_id.

import Link from "next/link";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { Pill } from "@/components/ui/Pill";
import { getCurrentTech } from "@/lib/current-tech";
import { getEstimateDetail } from "./actions";
import { EstimateEditForm } from "./EstimateEditForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Estimate · TPAR-DB" };

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function statusTone(s: string | null): "green" | "brand" | "slate" | "neutral" {
  switch (s) {
    case "approved":
    case "pushed":
      return "green";
    case "preview":
      return "brand";
    case "archived":
      return "slate";
    default:
      return "neutral";
  }
}

export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentTech().catch(() => null);
  if (!me) redirect(`/login?from=/estimate/${id}`);

  const est = await getEstimateDetail(id);
  if (!est) {
    return (
      <PageShell title="Estimate not found" backHref="/estimates" backLabel="All estimates">
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          No estimate with id <code className="font-mono text-xs">{id}</code>.
        </div>
      </PageShell>
    );
  }

  const canEdit = !!me.isAdmin;
  const hcpUrl = est.hcp_estimate_id
    ? `https://pro.housecallpro.com/app/estimates/${est.hcp_estimate_id}`
    : null;

  return (
    <PageShell
      kicker="Estimate"
      title={est.project_name || est.customer_name || "Untitled estimate"}
      description={
        <span className="font-mono text-xs text-neutral-500">
          {est.id}{est.hcp_estimate_number ? ` · HCP #${est.hcp_estimate_number}` : ""}
        </span>
      }
      backHref="/estimates"
      backLabel="All estimates"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {est.is_ai_built ? (
            <Link
              href={`/estimate/${est.id}/review`}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
            >
              Review AI estimate →
            </Link>
          ) : null}
          {hcpUrl ? (
            <a
              href={hcpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Open in HCP ↗
            </a>
          ) : null}
        </div>
      }
    >
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Status</div>
          <div className="mb-3">
            <Pill tone={statusTone(est.status)}>{est.status ?? "—"}</Pill>
          </div>
          <dl className="space-y-1 text-sm text-neutral-700">
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-500">Source</dt>
              <dd>{est.source ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-500">Created</dt>
              <dd>{fmtDate(est.created_at)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-500">By</dt>
              <dd>{est.created_by ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-500">Pushed to HCP</dt>
              <dd>{fmtDate(est.hcp_pushed_at)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-500">Customer approved</dt>
              <dd>{fmtDate(est.customer_approved_at)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-500">Tech authorized</dt>
              <dd>{fmtDate(est.tech_authorized_at)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Customer & job</div>
          <dl className="space-y-1 text-sm text-neutral-700">
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-500">Customer</dt>
              <dd>
                {est.hcp_customer_id ? (
                  <Link href={`/customer/${est.hcp_customer_id}`} className="font-medium text-brand-700 hover:underline">
                    {est.customer_name ?? est.hcp_customer_id}
                  </Link>
                ) : (
                  est.customer_name ?? "—"
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-500">Linked job</dt>
              <dd>
                {est.hcp_job_id ? (
                  <Link href={`/job/${est.hcp_job_id}`} className="font-mono text-xs text-brand-700 hover:underline">
                    {est.hcp_job_id}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-500">HCP estimate #</dt>
              <dd className="font-mono">{est.hcp_estimate_number ?? "—"}</dd>
            </div>
          </dl>
        </div>
      </div>

      <Section title="Edit">
        <EstimateEditForm
          id={est.id}
          initialStatus={est.status}
          initialProjectName={est.project_name}
          canEdit={canEdit}
        />
      </Section>

      <p className="mt-6 text-xs italic text-neutral-500">
        Line items + pricing live in HCP — use the &ldquo;Open in HCP&rdquo; button above for those edits.
      </p>
    </PageShell>
  );
}
