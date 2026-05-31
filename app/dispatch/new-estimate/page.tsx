import { redirect } from "next/navigation";
import Link from "next/link";
import { PageShell } from "../../../components/PageShell";
import { getCurrentTech } from "../../../lib/current-tech";
import { createEstimate, loadActiveTechs, searchCustomers } from "./actions";
import { CreateEstimateForm } from "./CreateEstimateForm";

export const metadata = { title: "New estimate · Dispatch · TPAR-DB" };
export const dynamic = "force-dynamic";

export default async function NewEstimatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/dispatch/new-estimate");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  const techs = await loadActiveTechs();
  const params = await searchParams;
  const initialDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : undefined;
  const initialTechId = params.tech ? techs.find((t) => t.hcp_full_name === params.tech)?.hcp_employee_id : undefined;

  return (
    <PageShell
      kicker="Tool · /dispatch"
      title="Create estimate"
      description="Book an estimate visit. Creates a scaffolding HCP estimate (1 option, 1 line item) that the tech fills out fully via /estimate-draft or HCP UI on-site."
    >
      <div className="mb-4">
        <Link href="/dispatch" className="text-xs text-neutral-500 hover:underline">← Back to dispatch</Link>
      </div>
      <CreateEstimateForm action={createEstimate} searchCustomers={searchCustomers} techs={techs} initialDate={initialDate} initialTechId={initialTechId} />
    </PageShell>
  );
}
