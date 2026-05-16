"use client";

// Tiny client wrapper that renders AppGuide with onSelect navigation —
// when the tech picks a job, we navigate to /voice-notes/new?job={id}
// so the URL becomes the source of truth (server picks it up via
// searchParams on next render).

import { useRouter } from "next/navigation";
import { AppGuide } from "../../../components/AppGuide";

export function VoiceNoteJobPicker() {
  const router = useRouter();
  return (
    <AppGuide
      label="Which job is this voice note about?"
      placeholder='"trotzuk" / "1342 east 25th" / "current" / leave empty for today'
      actions={["use"]}
      compact
      showAmbient={false}
      onSelect={(cand) => {
        // Prefer invoice_number for the URL since it's the friendlier identifier;
        // resolver handles both invoice + hcp_job_id formats per server-side code.
        const slug = cand.invoice_number ?? cand.hcp_job_id;
        router.push(`/voice-notes/new?job=${encodeURIComponent(slug)}`);
      }}
    />
  );
}
