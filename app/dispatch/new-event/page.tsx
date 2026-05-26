import { redirect } from "next/navigation";
import Link from "next/link";
import { PageShell } from "../../../components/PageShell";
import { getCurrentTech } from "../../../lib/current-tech";
import { createEvent, loadInternalLocations, loadActiveTechs } from "./actions";
import { CreateEventForm } from "./CreateEventForm";

export const metadata = { title: "New event · Dispatch · TPAR-DB" };
export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/dispatch/new-event");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  const [locations, techs] = await Promise.all([loadInternalLocations(), loadActiveTechs()]);

  return (
    <PageShell
      kicker="Tool · /dispatch"
      title="Create internal event"
      description="Book non-customer-facing work (HQ tasks, training, equipment, on-call) onto the dispatch calendar. Creates an HCP job tagged as internal so it shows up in /dispatch with the violet INTERNAL pill."
    >
      <div className="mb-4">
        <Link href="/dispatch" className="text-xs text-neutral-500 hover:underline">← Back to dispatch</Link>
      </div>

      {locations.length === 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          No internal-location customers found. The On-Call placeholder customer (cus_051289...) needs at least one address before events can be created. Use HCP UI to add one, then return here.
        </div>
      ) : (
        <CreateEventForm
          action={createEvent}
          locations={locations}
          techs={techs}
        />
      )}
    </PageShell>
  );
}
