// /job/[id]/estimate/new — dashboard counterpart to the /estimate-draft Slack flow.
// Pulls job context, hands off to <EstimateBuilder/> which collects line items
// and POSTs through the createEstimateForJob server action → create-estimate-direct edge fn.

import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "../../../../../lib/supabase";
import { PageShell } from "../../../../../components/PageShell";
import { EstimateBuilder } from "../../../../../components/EstimateBuilder";
import { getSessionUser } from "../../../../../lib/supabase-server";
import { getCurrentTech } from "../../../../../lib/current-tech";
import { EmptyState } from "../../../../../components/ui/EmptyState";

export const metadata = { title: "New estimate · TPAR-DB" };

export default async function NewEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect(`/login?from=/job`);

  const me = await getCurrentTech().catch(() => null);
  const canWrite = !!me?.canWrite;

  const { id } = await params;
  const supa = db();
  const { data: job } = await supa
    .from("job_360")
    .select("hcp_job_id, hcp_customer_id, customer_name, street, city, invoice_number")
    .eq("hcp_job_id", id)
    .maybeSingle();

  if (!job) {
    return (
      <PageShell title="Job not found">
        <p className="text-sm text-neutral-600">No job with id <code>{id}</code>.</p>
        <Link href="/jobs" className="mt-3 inline-block text-sm text-neutral-700 underline">← All jobs</Link>
      </PageShell>
    );
  }

  const customerName = (job.customer_name as string | null) ?? "(unknown)";
  const invoiceNum = (job.invoice_number as string | null) ?? id.slice(-8);
  const defaultProjectName = `Plumbing scope for ${customerName} · ${invoiceNum}`;

  return (
    <PageShell
      title="Build a multi-option estimate"
      description={`${customerName}${job.street ? ` · ${job.street}${job.city ? ", " + job.city : ""}` : ""} — pushes to HCP after review.`}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/job/${id}`} className="text-xs text-neutral-500 hover:underline">← Back to job</Link>
        {canWrite ? (
          <Link
            href={`/job/${id}/estimate/from-voice-note`}
            className="rounded-md bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200 hover:bg-brand-100"
          >
            ✨ Based on a voice note…
          </Link>
        ) : null}
      </div>

      {canWrite ? (
        <EstimateBuilder
          hcpJobId={id}
          customerName={customerName}
          defaultProjectName={defaultProjectName}
        />
      ) : (
        <EmptyState
          title="Manager view — read-only."
          description="Estimates are pushed to HCP by Danny or a tech. You're seeing the same context they would; the builder UI is hidden because submissions would be blocked server-side."
        />
      )}
    </PageShell>
  );
}
