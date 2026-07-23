// notify-management — fan a Slack DM out to the management tier (admin + manager +
// production_manager) via the deployed notify-danny edge fn's recipient override.
// For office-actionable events that would otherwise sit unseen in a queue — e.g. a
// time-off request only surfaces on /manage today, and submitting it pings nobody
// (Danny 2026-07-22: the 7/23 request sat silent because the tech's "sent ✓" only
// meant the row saved). Best-effort + guaranteed fallback: if no manager has a
// slack_user_id on file, it DMs Danny (notify-danny's default recipient) so the
// signal never vanishes. GUIDE surface, never load-bearing — every failure path
// skips quietly + logs to maintenance_logs. Nothing customer-facing.

import { db } from "./supabase";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

async function sendDM(text: string, context: string, recipient_slack_user_id?: string): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { text, context };
    if (recipient_slack_user_id) body.recipient_slack_user_id = recipient_slack_user_id;
    const r = await fetch(`${SUPABASE_URL}/functions/v1/notify-danny`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function notifyManagement(input: { text: string; context: string }): Promise<void> {
  const supa = db();
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    const { data } = await supa
      .from("tech_directory")
      .select("slack_user_id, dashboard_role")
      .in("dashboard_role", ["admin", "manager", "production_manager"])
      .eq("is_active", true)
      .neq("is_test", true)
      .not("slack_user_id", "is", null);
    const ids = Array.from(new Set((data ?? [])
      .map((r) => (r as { slack_user_id: string | null }).slack_user_id)
      .filter((x): x is string => !!x)));

    // Fan out to every reachable manager in parallel.
    const results = await Promise.all(ids.map((id) => sendDM(input.text, input.context, id)));
    const delivered = results.filter(Boolean).length;

    // Guaranteed fallback: nobody reachable by DM → ping Danny (default recipient),
    // so an office-actionable event never disappears into an unwatched queue.
    if (delivered === 0) await sendDM(input.text, input.context);

    if (delivered < ids.length) {
      await supa.from("maintenance_logs").insert({
        source: "notify-management", level: "info",
        message: `management DM fan-out: ${delivered}/${ids.length} delivered${delivered === 0 ? " (fell back to Danny)" : ""}`,
        context: { ctx: input.context, targets: ids.length },
      }).then(() => {}, () => {});
    }
  } catch (e) {
    await supa.from("maintenance_logs").insert({
      source: "notify-management", level: "warn",
      message: `notifyManagement threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
      context: { ctx: input.context },
    }).then(() => {}, () => {});
  }
}
