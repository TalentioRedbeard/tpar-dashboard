import { redirect } from "next/navigation";
import Link from "next/link";
import { PageShell } from "../../../components/PageShell";
import { getCurrentTech } from "../../../lib/current-tech";
import { createJob, loadActiveTechs, searchCustomers } from "./actions";
import { CreateJobForm } from "./CreateJobForm";

export const metadata = { title: "New job · Dispatch · TPAR-DB" };
export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/dispatch/new-job");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  const techs = await loadActiveTechs();

  return (
    <PageShell
      kicker="Tool · /dispatch"
      title="Create job"
      description="Book a customer-facing job onto the dispatch calendar. Webhook surfaces it on /dispatch in ~30s. Leave 'Notify customer' unchecked for test runs."
    >
      <div className="mb-4">
        <Link href="/dispatch" className="text-xs text-neutral-500 hover:underline">← Back to dispatch</Link>
      </div>

      <CreateJobForm
        action={createJob}
        searchCustomers={searchCustomers}
        techs={techs}
      />
    </PageShell>
  );
}
