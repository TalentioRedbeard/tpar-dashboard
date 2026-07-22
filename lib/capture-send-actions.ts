"use server";

// Send a capture to a TEAMMATE — Studio Send-UI (Danny 2026-07-21, the fast-follow
// after the 6 segments). Two channels on top of proven edge-fn primitives:
//   • Slack DM  → notify-danny with recipient_slack_user_id override
//   • Email     → send-gmail-note (sends EXACTLY to `to`, the send-test-safe path)
// Scope: only the capture's owner (created_by_uid) or leadership may send it, and
// the recipient is always an INTERNAL roster teammate — never an arbitrary/customer
// address (no exfil of a customer-conversation transcript). Message = title +
// transcript + a 1-hour signed listen-link.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { getSessionUser } from "@/lib/supabase-server";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type SendableTeammate = { tech_id: string; label: string; hasSlack: boolean; hasEmail: boolean };

// Active, non-test teammates reachable by Slack or email (the send picker).
export async function getSendableTeammates(): Promise<SendableTeammate[]> {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return [];
  const { data } = await db()
    .from("tech_directory")
    .select("tech_id, tech_short_name, hcp_full_name, slack_user_id, email, is_active, is_test")
    .eq("is_active", true)
    .order("tech_short_name", { ascending: true });
  return (data ?? [])
    .filter((t) => !(t as { is_test?: boolean }).is_test)
    .map((t) => {
      const r = t as { tech_id: string | number; tech_short_name?: string | null; hcp_full_name?: string | null; slack_user_id?: string | null; email?: string | null };
      return {
        tech_id: String(r.tech_id),
        label: r.tech_short_name || r.hcp_full_name || "teammate",
        hasSlack: !!r.slack_user_id,
        hasEmail: !!(r.email && r.email.includes("@")),
      };
    })
    .filter((t) => t.hasSlack || t.hasEmail);
}

export async function sendCaptureToTeammate(input: {
  recordingId: string;
  teammateTechId: string;
  channel: "slack" | "email";
}): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return { ok: false, error: "not signed in" };
  const sess = await getSessionUser().catch(() => null);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return { ok: false, error: "server isn't configured to send" };
  const supa = db();

  // Capture scope: owner (stable created_by_uid) or leadership — a tech can't send
  // another tech's capture.
  const { data: rec } = await supa
    .from("recordings")
    .select("created_by_uid, transcript, label, audio_path")
    .eq("id", input.recordingId)
    .maybeSingle();
  if (!rec) return { ok: false, error: "recording not found" };
  const mine = !!sess?.id && rec.created_by_uid === sess.id;
  if (!mine && !me.isAdmin && !me.isManager) return { ok: false, error: "not your recording" };

  // Recipient: INTERNAL roster teammate only (resolved server-side from tech_id) —
  // never a client-supplied address, so a transcript can't be emailed off to anyone.
  const { data: tm } = await supa
    .from("tech_directory")
    .select("tech_short_name, hcp_full_name, slack_user_id, email, is_active, is_test")
    .eq("tech_id", input.teammateTechId)
    .maybeSingle();
  if (!tm || (tm as { is_test?: boolean }).is_test || !(tm as { is_active?: boolean }).is_active) {
    return { ok: false, error: "teammate not found" };
  }
  const t = tm as { tech_short_name?: string | null; hcp_full_name?: string | null; slack_user_id?: string | null; email?: string | null };
  const tmName = t.tech_short_name || t.hcp_full_name || "teammate";
  const fromName = me.tech?.tech_short_name ?? me.email ?? "a teammate";
  const title = (rec.label as string | null)?.trim() || "Voice note";
  const transcript = (rec.transcript as string | null)?.trim() || "(no transcript yet)";

  // 1-hour signed listen link (private bucket) so they can hear it.
  let listen = "";
  if (rec.audio_path) {
    const { data: su } = await supa.storage.from("recordings").createSignedUrl(rec.audio_path as string, 3600);
    if (su?.signedUrl) listen = `\n\n🎧 Listen (link expires in 1h): ${su.signedUrl}`;
  }

  if (input.channel === "slack") {
    if (!t.slack_user_id) return { ok: false, error: `${tmName} has no Slack linked.` };
    const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-danny`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({
        text: `🎙 *${title}* — from ${fromName}\n\n${transcript}${listen}`,
        context: "studio recording",
        recipient_slack_user_id: t.slack_user_id,
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !j?.ok) return { ok: false, error: j?.error ?? `Slack send failed (${res.status})` };
    return { ok: true };
  }

  // email
  if (!t.email || !t.email.includes("@")) return { ok: false, error: `${tmName} has no email on file.` };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-gmail-note`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify({
      to: t.email,
      subject: `🎙 ${title} — from ${fromName}`,
      body: `${title} — from ${fromName}\n\n${transcript}${listen}\n\n(Sent from TPAR Studio)`,
      from_name: "TPAR Studio",
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !j?.ok) return { ok: false, error: j?.error ?? `Email send failed (${res.status})` };
  return { ok: true };
}
