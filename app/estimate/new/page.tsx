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
  searchParams: Promise<{ customer?: string; job?: string; appointment?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?from=/estimate/new");

  const me = await getCurrentTech().catch(() => null);
  const canWrite = !!me?.canWrite;

  const sp = await searchParams;
  const customerParam = (sp.customer ?? "").trim();
  const jobParam = (sp.job ?? "").trim();
  const appointmentParam = (sp.appointment ?? "").trim();

  const supa = db();
  let initialCustomer: { hcpCustomerId: string; name: string } | null = null;
  let initialJob: {
    hcpJobId: string;
    addressId: string | null;
    techEmployeeId: string | null;
    techName: string | null;
  } | null = null;
  let backHref = "/estimates";
  // When entering from an estimate appointment, seed the builder from the visit
  // notes so it auto-drafts good/better/best on mount (the SalesAsk-killer flow).
  let autoSeed: { freeform: string; imageUrls?: string[] } | null = null;

  if (appointmentParam) {
    // Resolve the customer DIRECTLY from the appointment row — estimate customers
    // are routinely absent from customer_360 (the known blocker), so we never
    // route through it here.
    const { data: appt } = await supa
      .from("appointments_master")
      .select("hcp_customer_id, customer_name, hcp_notes, notes, tech_primary_id, tech_primary_name, raw")
      .eq("appointment_id", appointmentParam)
      .maybeSingle();
    if (appt?.hcp_customer_id) {
      initialCustomer = {
        hcpCustomerId: appt.hcp_customer_id as string,
        name: (appt.customer_name as string | null) ?? "(customer)",
      };
      const raw = (appt.raw ?? {}) as Record<string, unknown>;
      const addr = (raw.address ?? {}) as Record<string, unknown>;
      initialJob = {
        hcpJobId: "",
        addressId: typeof addr.id === "string" ? (addr.id as string) : null,
        techEmployeeId: (appt.tech_primary_id as string | null) ?? null,
        techName: (appt.tech_primary_name as string | null) ?? null,
      };
      autoSeed = { freeform: (appt.hcp_notes as string | null) ?? (appt.notes as string | null) ?? "" };
      backHref = "/me";
    }
  } else if (jobParam) {
    const [{ data: job }, { data: jr }] = await Promise.all([
      supa.from("job_360").select("hcp_customer_id, customer_name").eq("hcp_job_id", jobParam).maybeSingle(),
      supa.from("hcp_jobs_raw").select("raw").eq("hcp_job_id", jobParam).maybeSingle(),
    ]);
    if (job?.hcp_customer_id) {
      initialCustomer = { hcpCustomerId: job.hcp_customer_id as string, name: (job.customer_name as string | null) ?? "(customer)" };
      backHref = `/job/${jobParam}`;
      // Inherit the job's assigned tech + service address so the estimate isn't
      // created context-free (auto-fill known fields — Danny 2026-06-03 rule).
      const raw = (jr?.raw ?? {}) as Record<string, unknown>;
      const assigned = Array.isArray(raw.assigned_employees) ? (raw.assigned_employees as Array<Record<string, unknown>>) : [];
      const primary = assigned[0] ?? null;
      const addr = (raw.address ?? {}) as Record<string, unknown>;
      initialJob = {
        hcpJobId: jobParam,
        addressId: typeof addr.id === "string" ? (addr.id as string) : null,
        techEmployeeId: primary && typeof primary.id === "string" ? (primary.id as string) : null,
        techName: primary
          ? (`${(primary.first_name as string | undefined) ?? ""} ${(primary.last_name as string | undefined) ?? ""}`.trim() || null)
          : null,
      };
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
      description="Each option is built with the 4-question pricebook cascade (Type → Category → Work type → Item) + hours/crew/materials. The customer picks an option. Creates the estimate after you review (synced to Housecall Pro)."
      backHref={backHref}
      backLabel="Back"
    >
      {canWrite ? (
        <MultiOptionEstimateBuilder initialCustomer={initialCustomer} initialJob={initialJob} backHref={backHref} autoSeed={autoSeed} />
      ) : (
        <EmptyState
          title="Manager view — read-only."
          description="Estimates are pushed to HCP by Danny or a tech. The builder UI is hidden because submissions would be blocked server-side."
        />
      )}
    </PageShell>
  );
}
