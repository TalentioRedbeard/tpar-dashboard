// Receipt reconciliation (#2, 2026-06-18). Leadership surface (admin + manager) to attribute
// the ~681 unattributed receipts / ~$431k of material spend to jobs (so cost lands in margin)
// or mark them overhead. Gated by the /reports layout (admin + manager) + the actions re-gate.

import { PageShell } from "@/components/PageShell";
import { getUnlinkedReceipts } from "@/lib/receipt-reconcile-actions";
import { ReceiptReconcileList } from "@/components/ReceiptReconcileList";

export const metadata = { title: "Receipt reconciliation · TPAR-DB" };
export const dynamic = "force-dynamic";

const SOURCES = ["email", "credit_card", "locke", "winnelson", "slack_photo", "dashboard"];

export default async function ReceiptsReconcilePage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const sp = await searchParams;
  const source = (sp.source ?? "").trim() || null;
  const res = await getUnlinkedReceipts({ source: source ?? undefined, limit: 60 });

  return (
    <PageShell
      title="Receipt reconciliation"
      description="Attach unattributed receipts to a job (so their cost lands in job margin) or mark them overhead. Auto-suggests by tech + date; search to attach to any project."
      backHref="/reports"
      backLabel="Reports"
    >
      {"error" in res ? (
        <p className="text-sm text-neutral-500">You don&apos;t have access to this.</p>
      ) : (
        <ReceiptReconcileList initialRows={res.rows} summary={res.summary} sources={SOURCES} activeSource={source} />
      )}
    </PageShell>
  );
}
