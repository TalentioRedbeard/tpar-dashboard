// /estimate/new — standalone multi-option estimate builder (4-question
// methodology). Reachable from the customer page (?customer=cus_...), job page
// (?job=job_...), the estimates list, and the dashboard (no param → customer
// picker). Hands off to <MultiOptionEstimateBuilder/> → createMultiOptionEstimate
// → create-estimate-direct. Static `new` segment takes precedence over
// /estimate/[id].

import { redirect } from "next/navigation";
import { db } from "@/lib/supabase";
import { PageShell } from "@/components/PageShell";
import { MultiOptionEstimateBuilder } from "@/components/MultiOptionEstimateBuilder";
import { getSessionUser } from "@/lib/supabase-server";
import { getCurrentTech } from "@/lib/current-tech";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata = { title: "New estimate · TPAR-DB" };
export const dynamic = "force-dynamic";

export default async function NewMultiOptionEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; job?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?from=/estimate/new");

  const me = await getCurrentTech().catch(() => null);
  const canWrite = !!me?.canWrite;

  const sp = await searchParams;
  const customerParam = (sp.customer ?? "").trim();
  const jobParam = (sp.job ?? "").trim();

  const supa = db();
  let initialCustomer: { hcpCustomerId: string; name: string } | null = null;
  let backHref = "/estimates";

  if (jobParam) {
    const { data: job } = await supa
      .from("job_360")
      .select("hcp_customer_id, customer_name")
      .eq("hcp_job_id", jobParam)
      .maybeSingle();
    if (job?.hcp_customer_id) {
      initialCustomer = { hcpCustomerId: job.hcp_customer_id as string, name: (job.customer_name as string | null) ?? "(customer)" };
      backHref = `/job/${jobParam}`;
    }
  } else if (customerParam) {
    const { data: c } = await supa
      .from("customer_360")
      .select("hcp_customer_id, name, first_name, last_name")
      .eq("hcp_customer_id", customerParam)
      .maybeSingle();
    if (c) {
      const nm = (c.name as string | null)?.trim()
        || [c.first_name, c.last_name].map((v) => ((v as string | null) ?? "").trim()).filter(Boolean).join(" ")
        || "(customer)";
      initialCustomer = { hcpCustomerId: c.hcp_customer_id as string, name: nm };
      backHref = `/customer/${customerParam}`;
    }
  }

  return (
    <PageShell
      kicker="Estimate"
      title="Build a multi-option estimate"
      description="Each option is built with the 4-question pricebook cascade (Type → Category → Work type → Item) + hours/crew/materials. The customer picks an option. Pushes to HCP after you review."
      backHref={backHref}
      backLabel="Back"
    >
      {canWrite ? (
        <MultiOptionEstimateBuilder initialCustomer={initialCustomer} backHref={backHref} />
      ) : (
        <EmptyState
          title="Manager view — read-only."
          description="Estimates are pushed to HCP by Danny or a tech. The builder UI is hidden because submissions would be blocked server-side."
        />
      )}
    </PageShell>
  );
}
