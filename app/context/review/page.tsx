import { getCurrentTech } from "@/lib/current-tech";
import { isOwner } from "@/lib/admin";
import { listProposedContext } from "@/lib/context-review-actions";
import { ContextReviewPanel } from "@/components/ContextReviewPanel";

export const dynamic = "force-dynamic";

export default async function ContextReviewPage() {
  const me = await getCurrentTech();
  if (!me || !isOwner(me.realEmail)) {
    return <div className="p-6 text-sm text-neutral-600">Owner only.</div>;
  }
  const items = await listProposedContext();
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-lg font-semibold">Customer context — review</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Context the on-prem AI proposed from recorded conversations. Confirm to keep it on the
        customer, or reject to discard. Sensitive (category-D) context stays on the server and is not shown here.
      </p>
      <div className="mt-4">
        <ContextReviewPanel items={items} />
      </div>
    </div>
  );
}
