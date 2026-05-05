// /voice-notes/new — record or upload a voice note. Optionally attach to
// a job (?job=hcp_job_id) or customer (?customer=hcp_customer_id) so the
// generator gets job context for free.

import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentTech } from "@/lib/current-tech";
import { db } from "@/lib/supabase";
import { PageShell } from "@/components/PageShell";
import { VoiceNoteRecorder } from "../VoiceNoteRecorder";

export const metadata = { title: "New voice note · TPAR-DB" };

export default async function NewVoiceNotePage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; customer?: string }>;
}) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/voice-notes/new");

  const params = await searchParams;
  const hcpJobId = params.job?.trim();
  const hcpCustomerId = params.customer?.trim();

  // Attach context label so the user knows what this note is being saved against.
  let attached: { label: string; href: string } | null = null;
  if (hcpJobId) {
    const supa = db();
    const { data } = await supa
      .from("job_360")
      .select("customer_name, invoice_number")
      .eq("hcp_job_id", hcpJobId)
      .maybeSingle();
    if (data) {
      attached = {
        label: `${data.customer_name ?? "(unknown)"} — invoice ${data.invoice_number ?? "—"}`,
        href: `/job/${hcpJobId}`,
      };
    }
  } else if (hcpCustomerId) {
    const supa = db();
    const { data } = await supa
      .from("customer_360")
      .select("customer_name")
      .eq("hcp_customer_id", hcpCustomerId)
      .maybeSingle();
    if (data) {
      attached = {
        label: data.customer_name ?? "(unknown customer)",
        href: `/customer/${hcpCustomerId}`,
      };
    }
  }

  return (
    <PageShell
      kicker="Voice notes"
      title="New voice note"
      description={
        attached ? (
          <span>
            Attaching to <Link href={attached.href} className="font-medium text-brand-700 hover:underline">{attached.label}</Link>
          </span>
        ) : (
          <span>
            Standalone voice note. Tip: launch from <Link href="/jobs" className="text-brand-700 hover:underline">a job page</Link> to auto-attach.
          </span>
        )
      }
    >
      <VoiceNoteRecorder
        hcpJobId={hcpJobId}
        hcpCustomerId={hcpCustomerId}
        defaultIntentTag="estimate-context"
      />

      <div className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
        <strong className="text-neutral-700">What happens next:</strong> the audio is stored in a private bucket,
        transcribed by Whisper, and saved as a <code className="rounded bg-white px-1">tech_voice_notes</code> row.
        On the next page you can use it as a "Based on…" reference to generate structured Tool 3 line items
        or full option sets.
      </div>
    </PageShell>
  );
}
