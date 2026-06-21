// /voice-notes/new — record or upload a voice note. Optionally attach to
// a job (?job=hcp_job_id) or customer (?customer=hcp_customer_id) so the
// generator gets job context for free.

import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentTech } from "@/lib/current-tech";
import { db } from "@/lib/supabase";
import { PageShell } from "@/components/PageShell";
import { VoiceNoteRecorder } from "../VoiceNoteRecorder";
import { TECH_INTENTS, LEADERSHIP_INTENTS, PRIMARY_INTENTS } from "../intents";
import { VoiceNoteJobPicker } from "./VoiceNoteJobPicker";
import { resolveJobIdentifier } from "@/lib/typed-db/job-360";

export const metadata = { title: "New voice note · TPAR-DB" };

export default async function NewVoiceNotePage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; customer?: string; intent?: string }>;
}) {
  const me = await getCurrentTech().catch(() => null);
  if (!me) redirect("/login?from=/voice-notes/new");

  const params = await searchParams;
  const jobInput = params.job?.trim();
  const hcpCustomerId = params.customer?.trim();
  // Accept ?intent=diagnostic|change-order|billing|other from the /me tile or
  // anywhere else that wants to pre-tag the recording. If not provided, the
  // primary-intent picker is shown at the top of the page so the user picks
  // one before recording.
  const intentParam = params.intent?.trim().toLowerCase();
  const validIntents = new Set(PRIMARY_INTENTS.map((o) => o.value));
  const preselectedIntent = intentParam && validIntents.has(intentParam) ? intentParam : null;

  // The `job` query param may be an actual hcp_job_id (job_xxx...) or, more
  // commonly, an invoice number the tech typed. Resolve via the canonical
  // resolver so /voice-notes/new?job=27691236 works as expected.
  // (Per feedback_job_id_vs_invoice_conundrum_2026-05-13.md)
  let hcpJobId: string | undefined = undefined;
  let attached: { label: string; href: string } | null = null;
  if (jobInput) {
    // Wrapped so a resolver hiccup never 500s the page — it just falls back to
    // a standalone note. (Align Design, for instance, is an upcoming
    // appointment not yet in job_360, so it resolves to "none" — that's fine.)
    try {
      const resolved = await resolveJobIdentifier(jobInput);
      if (resolved.kind === "hcp_id" || resolved.kind === "invoice") {
        const row = resolved.row as Record<string, unknown>;
        hcpJobId = row.hcp_job_id as string;
        const customer = (row.customer_name as string | null) ?? "(unknown)";
        const invoice = (row.invoice_number as string | null) ?? "—";
        attached = {
          label: `${customer} — invoice ${invoice}`,
          href: `/job/${hcpJobId}`,
        };
      }
      // "invoice_multiple" / "none" → leave unattached; recorder saves a
      // standalone note (still useful).
    } catch {
      // Resolver failed — proceed as a standalone note rather than erroring.
    }
  }
  if (!attached && hcpCustomerId) {
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
      {/* Primary-intent picker — surfaced at the top so the user explicitly
       *  picks WHAT this recording is for before recording starts. When the
       *  URL already includes ?intent=, this section auto-confirms and the
       *  recorder is shown below. */}
      {!preselectedIntent ? (
        <div className="mb-5 rounded-2xl border border-brand-200 bg-brand-50 p-4">
          <div className="mb-2 text-sm font-semibold text-brand-900">What kind of voice note?</div>
          <div className="mb-3 text-xs text-brand-900/80">Pick one — this tags the recording so it lands in the right review queue.</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PRIMARY_INTENTS.map((opt) => {
              const qp = new URLSearchParams();
              if (jobInput)        qp.set("job", jobInput);
              if (hcpCustomerId)   qp.set("customer", hcpCustomerId);
              qp.set("intent", opt.value);
              return (
                <Link
                  key={opt.value}
                  href={`/voice-notes/new?${qp.toString()}`}
                  className="rounded-md border border-brand-300 bg-white px-3 py-2 text-sm font-medium text-brand-900 hover:bg-brand-100"
                >
                  {opt.label}
                </Link>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mb-4 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
          Recording as: <span className="font-medium">{PRIMARY_INTENTS.find((o) => o.value === preselectedIntent)?.label ?? preselectedIntent}</span>
          {" · "}
          <Link href={`/voice-notes/new${jobInput ? `?job=${jobInput}` : ""}`} className="underline">change</Link>
        </div>
      )}

      {/* AppGuide — picks the job for the voice note when not already attached.
       *  Hidden when ?job= already resolved (the description above shows attachment). */}
      {!attached ? (
        <div className="mb-5">
          <VoiceNoteJobPicker />
        </div>
      ) : null}

      <VoiceNoteRecorder
        hcpJobId={hcpJobId}
        hcpCustomerId={hcpCustomerId}
        defaultIntentTag={preselectedIntent ?? "diagnostic"}
        intentOptions={(me.isAdmin || me.isManager) ? LEADERSHIP_INTENTS : TECH_INTENTS}
        showNeedsDiscussion={me.isAdmin || me.isManager}
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
