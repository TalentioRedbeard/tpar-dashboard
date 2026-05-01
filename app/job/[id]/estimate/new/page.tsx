// /job/[id]/estimate/new — dashboard counterpart to the /estimate-draft Slack flow.
// Pulls job context, hands off to <EstimateBuilder/> which collects line items
// and POSTs through the createEstimateForJob server action → create-estimate-direct edge fn.

import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "../../../../../lib/supabase";
import { PageShell } from "../../../../../components/PageShell";
import { EstimateBuilder } from "../../../../../components/EstimateBuilder";
import { getSessionUser } from "../../../../../lib/supabase-server";

export const metadata = { title: "New estimate · TPAR-DB" };

export default async function NewEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect(`/login?from=/job`);

  const { id } = await params;
  const supa = db();
  const { data: job } = await supa
    .from("job_360")
    .select("hcp_job_id, hcp_customer_id, customer_name, street, city, zip, invoice_number")
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
      description={`${customerName}${job.street ? ` · ${job.street}, ${job.city ?? ""}` : ""}${job.zip ? ` ${job.zip}` : ""} — pushes to HCP after review.`}
    >
      <div className="mb-4">
        <Link href={`/job/${id}`} className="text-xs text-neutral-500 hover:underline">← Back to job</Link>
      </div>

      <EstimateBuilder
        hcpJobId={id}
        customerName={customerName}
        defaultProjectName={defaultProjectName}
      />
    </PageShell>
  );
}
