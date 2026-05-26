import { redirect } from "next/navigation";
import Link from "next/link";
import { PageShell } from "../../../components/PageShell";
import { getCurrentTech } from "../../../lib/current-tech";
import { createEstimate, loadActiveTechs, searchCustomers } from "./actions";
import { CreateEstimateForm } from "./CreateEstimateForm";

export const metadata = { title: "New estimate · Dispatch · TPAR-DB" };
export const dynamic = "force-dynamic";

export default async function NewEstimatePage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/dispatch/new-estimate");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  const techs = await loadActiveTechs();

  return (
    <PageShell
      kicker="Tool · /dispatch"
      title="Create estimate"
      description="Book an estimate visit. Creates a scaffolding HCP estimate (1 option, 1 line item) that the tech fills out fully via /estimate-draft or HCP UI on-site."
    >
      <div className="mb-4">
        <Link href="/dispatch" className="text-xs text-neutral-500 hover:underline">← Back to dispatch</Link>
      </div>
      <CreateEstimateForm action={createEstimate} searchCustomers={searchCustomers} techs={techs} />
    </PageShell>
  );
}
