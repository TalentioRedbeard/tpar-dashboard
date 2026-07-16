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
      help={{
        intent: "Log a parts/supplies receipt the minute you get it — snap it, tag it, done. Faster than texting it in.",
        actions: [
          "Photo first: whole receipt in frame, not blurry.",
          "On a job? Type the invoice # from HCP. Shop/van stuff? Tap a chip — gas, tools, office, dining.",
          "Amount + vendor if you can read them off the paper; skip what you can't — the office sorts the rest.",
          "Submit. It lands on the job's costs and the spend reports on its own.",
        ],
        stuck: <>Upload failed? Try again — resubmitting the same photo won&apos;t double-log it. Still failing, text the photo to Danny so it isn&apos;t lost.</>,
      }}
    >
      <ReceiptForm techShortName={me.tech?.tech_short_name ?? me.email} canWrite={me.canWrite || me.isManager} />
    </PageShell>
  );
}
