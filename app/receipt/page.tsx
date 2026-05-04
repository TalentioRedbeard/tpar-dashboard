// /receipt — web upload flow for paper receipts.
// Mobile-first; uses the device camera capture for photos.

import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { ReceiptForm } from "./ReceiptForm";

export const dynamic = "force-dynamic";

export default async function ReceiptPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/receipt");

  return (
    <PageShell
      kicker="Receipt"
      title="Log a receipt"
      description="Snap the receipt, fill the basics, submit. Everything else gets sorted later."
    >
      <ReceiptForm techShortName={me.tech?.tech_short_name ?? me.email} canWrite={me.canWrite} />
    </PageShell>
  );
}
