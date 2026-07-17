// notify-tech — the per-tech Slack DM lane for feedback answers (spec §3d).
// Rides the deployed notify-danny edge fn's recipient override rather than a
// new Slack integration: same auth, same logging, zero new env. GUIDE surface,
// never load-bearing — every failure path skips quietly (+ maintenance_logs);
// the tech's /me "Heard" card is the guaranteed lane either way.
// SMS deliberately untouched (TEST-MODE pending A2P); nothing customer-facing.

import { db } from "./supabase";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function notifyTechFeedback(input: {
  itemId: string;
  tech: string;          // tech_short_name
  wrapDate: string;      // YYYY-MM-DD
  summary: string;
  responseNote: string;
  respondedBy: string;   // email — display trims to the handle
}): Promise<void> {
  const supa = db();
  try {
    const { data: td } = await supa
      .from("tech_directory")
      .select("slack_user_id, prefs")
      .eq("tech_short_name", input.tech)
      .eq("is_active", true)
      .maybeSingle();
    const prefs = (td?.prefs && typeof td.prefs === "object" ? td.prefs : {}) as { feedback_dm_opt_out?: boolean };
    if (prefs.feedback_dm_opt_out === true) return; // their choice; /me still shows it
    const slackId = (td?.slack_user_id as string | null) ?? null;
    if (!slackId) {
      await supa.from("maintenance_logs").insert({
        source: "notify-tech", level: "warn",
        message: `feedback answer DM skipped — no slack_user_id for ${input.tech}`,
        context: { feedback_item_id: input.itemId, tech: input.tech },
      });
      return;
    }

    const who = input.respondedBy.split("@")[0];
    const day = new Date(`${input.wrapDate}T12:00:00Z`)
      .toLocaleDateString("en-US", { timeZone: "UTC", month: "numeric", day: "numeric" });
    const text =
      `Re your wrap (${day}): «${input.summary.slice(0, 220)}»\n` +
      `${who}: ${input.responseNote.slice(0, 600)}\n` +
      `It's on your Home page too: https://tpar-dashboard.vercel.app/me`;

    const r = await fetch(`${SUPABASE_URL}/functions/v1/notify-danny`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ text, context: "feedback-answer", recipient_slack_user_id: slackId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) {
      await supa.from("feedback_items").update({ notified_at: new Date().toISOString() }).eq("id", input.itemId);
    } else {
      await supa.from("maintenance_logs").insert({
        source: "notify-tech", level: "warn",
        message: `feedback answer DM failed (${r.status}) for ${input.tech}`,
        context: { feedback_item_id: input.itemId },
      });
    }
  } catch (e) {
    await supa.from("maintenance_logs").insert({
      source: "notify-tech", level: "warn",
      message: `feedback answer DM threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
      context: { feedback_item_id: input.itemId },
    }).then(() => {}, () => {});
  }
}
