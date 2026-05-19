"use server";

// Server action for /notes/new — log a text note to management.
//
// Writes to tech_voice_notes (the existing voice-notes substrate, leadership
// extension). intent_tag='management_note' + needs_discussion=true mark it
// for the /admin/concerns triage queue. Also DMs Danny in Slack.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

export type NoteResult =
  | { ok: true; message: string; id: string }
  | { ok: false; message: string };

export async function postNoteToMgmt(_prev: NoteResult, formData: FormData): Promise<NoteResult> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, message: "not signed in" };

  const text = String(formData.get("text") ?? "").trim();
  const subjectRaw = String(formData.get("subject_tags") ?? "").trim();
  const hcpJobId = String(formData.get("hcp_job_id") ?? "").trim() || null;
  const hcpCustomerId = String(formData.get("hcp_customer_id") ?? "").trim() || null;
  const urgent = formData.get("urgent") === "1";

  if (!text) return { ok: false, message: "note body required" };
  if (text.length > 5000) return { ok: false, message: "note too long (5000 chars max)" };

  const supa = db();
  const subjectTags = subjectRaw
    ? subjectRaw.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
    : [];

  const { data: noteRow, error } = await supa
    .from("tech_voice_notes")
    .insert({
      source: "dashboard:notes/new",
      user_email: me.email,
      tech_short_name: me.tech?.tech_short_name ?? null,
      tech_full_name: me.tech?.hcp_full_name ?? null,
      hcp_job_id: hcpJobId,
      hcp_customer_id: hcpCustomerId,
      transcript: text,
      transcription_status: "not_applicable",
      intent_tag: "management_note",
      subject_tags: subjectTags,
      needs_discussion: true,
      raw_metadata: {
        urgent,
        submitted_via: "dashboard:/notes/new",
      },
    })
    .select("id")
    .single();

  if (error || !noteRow) return { ok: false, message: error?.message ?? "insert failed" };

  // DM Danny (best-effort)
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (SUPABASE_URL && SERVICE_KEY) {
      const asker = me.tech?.tech_short_name ?? me.email.split("@")[0];
      const urgentMark = urgent ? "🚨 *URGENT* " : "📝 ";
      const tagsLine = subjectTags.length > 0 ? `\n*Tags:* ${subjectTags.join(", ")}` : "";
      const linkLine = hcpJobId
        ? `\n_attached job: <https://tpar-dashboard.vercel.app/job/${hcpJobId}|${hcpJobId.slice(0, 12)}…>_`
        : hcpCustomerId
        ? `\n_attached customer: <https://tpar-dashboard.vercel.app/customer/${hcpCustomerId}|${hcpCustomerId.slice(0, 12)}…>_`
        : "";
      const slackText = `${urgentMark}*Note to management from ${asker}*\n\n${text.slice(0, 1500)}${text.length > 1500 ? "…" : ""}${tagsLine}${linkLine}\n\n<https://tpar-dashboard.vercel.app/admin/concerns|Concerns queue>`;
      await fetch(`${SUPABASE_URL}/functions/v1/notify-danny`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Trigger-Secret": process.env.NOTIFY_DANNY_SECRET ?? "",
        },
        body: JSON.stringify({ text: slackText, context: "note-to-mgmt" }),
      });
    }
  } catch { /* best-effort */ }

  revalidatePath("/notes/new");
  revalidatePath("/admin/concerns");
  return { ok: true, message: "✓ logged + Danny notified", id: noteRow.id as string };
}
