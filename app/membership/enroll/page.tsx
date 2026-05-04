// /membership/enroll — tech-led enrollment surface.
// Reached via "+ Add membership" link on /job/[id]. Carries job + customer
// context via query params so the form is pre-filled and the discount math is
// computed against the current job's revenue.

import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { getActiveTiers, getCurrentMembership } from "../actions";
import { EnrollForm } from "./EnrollForm";

export const dynamic = "force-dynamic";

export default async function EnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; job?: string }>;
}) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/membership/enroll");
  if (!me.canWrite) {
    return (
      <PageShell title="Read-only" description="You don't have write access for enrollment.">
        <EmptyState title="Ask Danny or a tech to enroll." />
      </PageShell>
    );
  }

  const params = await searchParams;
  const customerId = params.customer;
  const jobId = params.job;

  if (!customerId) {
    return (
      <PageShell title="Missing customer" description="Enrollment requires a customer context.">
        <EmptyState
          title="No customer specified."
          description={<>Open this page from a job or customer record (e.g. from the job detail page&apos;s &ldquo;Add membership&rdquo; link).</>}
        />
      </PageShell>
    );
  }

  const supabase = db();
  const [tiers, currentMembership, customerRow, jobRow] = await Promise.all([
    getActiveTiers(),
    getCurrentMembership(customerId),
    supabase.from("customer_360").select("name, hcp_customer_id").eq("hcp_customer_id", customerId).maybeSingle(),
    jobId
      ? supabase.from("job_360").select("hcp_job_id, customer_name, revenue, due_amount").eq("hcp_job_id", jobId).maybeSingle()
      : Promise.resolve({ data: null as null | Record<string, unknown> }),
  ]);

  const customerName = (customerRow.data as Record<string, unknown> | null)?.name as string | null
    ?? (jobRow.data as Record<string, unknown> | null)?.customer_name as string | null
    ?? "(unknown customer)";
  const currentBillDollars = jobRow.data
    ? Number((jobRow.data as Record<string, unknown>).revenue ?? 0)
    : 0;

  return (
    <PageShell
      kicker="Membership · Enroll"
      title={`Enroll ${customerName}`}
      description={
        <span>
          Sign this customer up for a TPAR membership. The bill discount is applied at the moment of enrollment.{" "}
          {jobId ? (
            <Link href={`/job/${jobId}`} className="text-brand-700 hover:underline">Back to job →</Link>
          ) : (
            <Link href={`/customer/${customerId}`} className="text-brand-700 hover:underline">Back to customer →</Link>
          )}
        </span>
      }
    >
      {currentMembership && currentMembership.status === "active" ? (
        <Section title="Already a member">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 text-sm text-emerald-900">
            <div className="font-medium">{currentMembership.customer_facing_name}</div>
            <div className="mt-1 text-xs text-emerald-800">
              Member since {new Date(currentMembership.started_at).toLocaleDateString()}
              {currentMembership.current_period_end ? (
                <> · renews {new Date(currentMembership.current_period_end).toLocaleDateString()}</>
              ) : null}
              {currentMembership.enrolled_by_tech ? <> · enrolled by {currentMembership.enrolled_by_tech}</> : null}
            </div>
            <div className="mt-2 text-xs">
              To change tiers, cancel current membership first (manager-only action).
            </div>
          </div>
        </Section>
      ) : (
        <EnrollForm
          customerId={customerId}
          customerName={customerName}
          jobId={jobId}
          currentBillDollars={currentBillDollars}
          tiers={tiers}
        />
      )}
    </PageShell>
  );
}
