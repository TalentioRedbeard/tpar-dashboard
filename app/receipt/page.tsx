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
        intent: "Snap a parts/supplies receipt right in the store. We figure out which job it goes on. Faster than texting Danny.",
        actions: [
          "Tap the photo button → take a picture of the receipt (whole thing in frame).",
          "Vendor + total auto-fill if the picture's clear. Override if wrong.",
          "Pick the job (we'll suggest based on time + your location).",
          "Submit. The receipt lands on the job's page; Kelsey reconciles it later.",
        ],
        stuck: <>Picture rejected? Make sure the whole receipt is in the frame and not blurry. If it still won&apos;t go, text it to Danny.</>,
      }}
    >
      <ReceiptForm techShortName={me.tech?.tech_short_name ?? me.email} canWrite={me.canWrite} />
    </PageShell>
  );
}
