// /voice-notes/[id] — view a voice note + generate a Based-on... line item
// or full option set. Output is read-only first cut; "copy into builder"
// integration is queued.

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { GenerateForm } from "./GenerateForm";

export const dynamic = "force-dynamic";

function fmtAbs(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function VoiceNotePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentTech();
  if (!me) redirect("/login");
  const { id } = await params;
  const supa = db();

  const { data: note } = await supa
    .from("tech_voice_notes")
    .select("id, ts, source, slack_user_id, user_email, tech_short_name, tech_full_name, hcp_job_id, hcp_customer_id, audio_url, audio_storage, audio_duration_seconds, audio_content_type, transcript, transcript_model, transcription_status, transcription_error, intent_tag, raw_metadata")
    .eq("id", id)
    .maybeSingle();

  if (!note) notFound();

  // Generate signed URL for audio playback (private bucket)
  let audioPlaybackUrl: string | null = null;
  if (note.audio_storage === "supabase-storage" && note.audio_url) {
    const signed = await supa.storage.from("voice-notes").createSignedUrl(note.audio_url, 60 * 60);
    audioPlaybackUrl = signed.data?.signedUrl ?? null;
  }

  // Job link if attached
  let jobLabel: string | null = null;
  if (note.hcp_job_id) {
    const { data: j } = await supa
      .from("job_360")
      .select("customer_name, invoice_number")
      .eq("hcp_job_id", note.hcp_job_id)
      .maybeSingle();
    if (j) jobLabel = `${j.customer_name ?? "(unknown)"} · invoice ${j.invoice_number ?? "—"}`;
  }

  return (
    <PageShell
      kicker="Voice note"
      title={note.tech_short_name ?? note.tech_full_name ?? note.user_email ?? "Voice note"}
      description={
        <span>
          Recorded {fmtAbs(note.ts)} · source <code className="rounded bg-neutral-100 px-1">{note.source}</code>
          {note.intent_tag ? <> · intent <code className="rounded bg-neutral-100 px-1">{note.intent_tag}</code></> : null}
          {note.audio_duration_seconds ? <> · {Math.round(note.audio_duration_seconds)}s</> : null}
        </span>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
        <Link href="/voice-notes" className="text-neutral-500 hover:underline">← All voice notes</Link>
        {note.hcp_job_id && jobLabel ? (
          <Link href={`/job/${note.hcp_job_id}`} className="rounded-md bg-brand-50 px-2 py-1 font-medium text-brand-700 hover:bg-brand-100">
            Linked to job: {jobLabel}
          </Link>
        ) : null}
      </div>

      <Section title="Audio">
        {audioPlaybackUrl ? (
          <audio controls src={audioPlaybackUrl} className="w-full" />
        ) : (
          <p className="text-sm text-neutral-500">No playback URL — audio may have been deleted from storage.</p>
        )}
      </Section>

      <div className="my-6" />

      <Section title="Transcript" description={note.transcript_model ? `via ${note.transcript_model}` : undefined}>
        {note.transcription_status === "transcribed" && note.transcript ? (
          <div className="whitespace-pre-wrap rounded-2xl border border-neutral-200 bg-white p-4 text-sm leading-relaxed text-neutral-800">
            {note.transcript}
          </div>
        ) : note.transcription_status === "failed" ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Transcription failed: {note.transcription_error ?? "(unknown error)"}
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Transcription status: {note.transcription_status}.
          </div>
        )}
      </Section>

      <div className="my-6" />

      {note.transcription_status === "transcribed" && note.transcript ? (
        <Section
          title="Based on… generator"
          description="Use this voice note as the reference. Output is structured Tool 3 JSON you can review and copy."
        >
          <GenerateForm
            voiceNoteId={note.id as string}
            hcpJobId={(note.hcp_job_id as string | null) ?? undefined}
            hcpCustomerId={(note.hcp_customer_id as string | null) ?? undefined}
          />
        </Section>
      ) : null}
    </PageShell>
  );
}
