import { getCurrentTech } from "@/lib/current-tech";
import { isOwner } from "@/lib/admin";
import { listDrafts } from "@/lib/draft-actions";
import { DraftsPanel } from "@/components/DraftsPanel";

export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const me = await getCurrentTech();
  if (!me || !isOwner(me.realEmail)) {
    return <div className="p-6 text-sm text-neutral-600">Owner only.</div>;
  }
  const initial = await listDrafts();
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-lg font-semibold">Context-aware drafts</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Request a draft for a customer; the on-prem 70B writes it using that customer&apos;s confirmed
        context (and sensitive context that never leaves the server, to shape tone only). Drafts are
        never auto-sent — review, copy, and send deliberately.
      </p>
      <div className="mt-4">
        <DraftsPanel initial={initial} />
      </div>
    </div>
  );
}
