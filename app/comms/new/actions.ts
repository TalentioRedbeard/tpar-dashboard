"use server";

// Server actions for /comms/new — send text or queue a phone callback.
//
// Both paths land a communication_events row so the comm threads into
// customer_360, /ask, AppGuide search, embeddings. Without that, sends are
// invisible to the rest of the system.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

export type SendMode = "sms" | "call";

export type SendResult =
  | { ok: true; message: string; sid?: string; queued_for?: string }
  | { ok: false; message: string };

function normalizeE164(raw: string): { ok: true; e164: string } | { ok: false; error: string } {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return { ok: true, e164: `+1${digits}` };
  if (digits.length === 11 && digits.startsWith("1")) return { ok: true, e164: `+${digits}` };
  if (digits.length >= 11 && raw.trim().startsWith("+")) return { ok: true, e164: `+${digits}` };
  return { ok: false, error: `phone number must be 10 digits or E.164: got "${raw}"` };
}

async function requireWriter(): Promise<{ email: string; short_name: string; emp_id: string | null } | { error: string }> {
  const me = await getCurrentTech();
  if (!me) return { error: "not signed in" };
  if (!me.isAdmin && me.dashboardRole !== "tech" && !me.isManager) {
    return { error: "not authorized" };
  }
  return {
    email: me.email,
    short_name: me.tech?.tech_short_name ?? me.email.split("@")[0],
    emp_id: me.tech?.hcp_employee_id ?? null,
  };
}

export async function sendComms(_prev: SendResult, formData: FormData): Promise<SendResult> {
  const writer = await requireWriter();
  if ("error" in writer) return { ok: false, message: writer.error };

  const mode = String(formData.get("mode") ?? "").trim() as SendMode;
  const toRaw = String(formData.get("to") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const hcpCustomerId = String(formData.get("hcp_customer_id") ?? "").trim() || null;
  const hcpJobId = String(formData.get("hcp_job_id") ?? "").trim() || null;
  const recipientType = String(formData.get("recipient_type") ?? "other").trim();
  const fireAtRaw = String(formData.get("fire_at") ?? "").trim();

  if (mode !== "sms" && mode !== "call") return { ok: false, message: `invalid mode: ${mode}` };
  if (!toRaw) return { ok: false, message: "recipient phone required" };
  if (!body) return { ok: false, message: mode === "sms" ? "message body required" : "call context required" };

  const phone = normalizeE164(toRaw);
  if (!phone.ok) return { ok: false, message: phone.error };

  const supa = db();
  const now = new Date().toISOString();

  const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!SUPABASE_URL) return { ok: false, message: "SUPABASE_URL not configured" };

  if (mode === "sms") {
    // Honor per-person opt-out (techs). Business comms intentionally relaxes the
    // app_flags master switch + quiet hours (Danny 2026-06-04), but a contact who
    // opted out is never texted — checked by phone so it holds even when the
    // number is hand-typed rather than picked from the directory.
    // .limit(1) (not maybeSingle) so a shared phone on 2+ rows doesn't error out
    // and silently fail open; treat any query error as block-to-be-safe.
    const { data: optRows, error: optErr } = await supa
      .from("tech_directory")
      .select("tech_short_name")
      .eq("phone", phone.e164)
      .eq("sms_opt_out", true)
      .limit(1);
    if (optErr) return { ok: false, message: `opt-out check failed — not sending: ${optErr.message}` };
    if (optRows && optRows.length > 0) {
      return { ok: false, message: `${(optRows[0].tech_short_name as string | null) ?? "That contact"} has opted out of texts — use a call instead.` };
    }

    // 1. Fire Twilio via existing send-sms edge fn
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Dashboard never has SEND_SMS_SECRET in env; service-role Bearer is the
        // pattern used by all other cross-fn calls from server actions.
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
      },
      body: JSON.stringify({
        to: phone.e164,
        text: body,
        context: `comms/new:${recipientType}:${writer.short_name}`,
      }),
    });
    const j = await res.json().catch(() => ({})) as { ok?: boolean; sid?: string; error?: string };
    if (!res.ok || !j.ok) return { ok: false, message: `send-sms failed: ${j.error ?? `HTTP ${res.status}`}` };

    // 2. Write to text_messages (best-effort)
    const sendbirdMessageId = -Math.floor(Date.now() * 1000 + Math.random() * 1000);
    await supa.from("text_messages").insert({
      sendbird_message_id: sendbirdMessageId,  // negative = our own outbound (no Sendbird origin)
      sendbird_channel_url: `outbound:${writer.short_name}:${phone.e164}`,
      hcp_customer_id: hcpCustomerId,
      hcp_employee_id: writer.emp_id,
      hcp_job_id: hcpJobId,
      channel_custom_type: recipientType === "customer" ? "customers" : "outbound_other",
      direction: "outbound",
      sender_user_id: writer.emp_id,
      sender_role: "employee",
      sender_display_name: writer.short_name,
      tech_short_name: writer.short_name,
      customer_phone: phone.e164,
      sent_at: now,
      message_type: "MESG",
      body,
      raw: { source: "dashboard:/comms/new", twilio_sid: j.sid ?? null, recipient_type: recipientType },
    });

    // 3. Emit communication_events so it shows up in customer 360, /ask, etc.
    await supa.from("communication_events").insert({
      occurred_at: now,
      channel: "sms",
      direction: "outbound",
      hcp_customer_id: hcpCustomerId,
      hcp_employee_id: writer.emp_id,
      hcp_job_id: hcpJobId,
      tech_short_name: writer.short_name,
      counterparty: phone.e164,
      content_text: body,
      summary: body.slice(0, 200),
      source_table: "text_messages",
      source_id: String(sendbirdMessageId),
      raw_metadata: {
        sent_via: "dashboard:/comms/new",
        recipient_type: recipientType,
        twilio_sid: j.sid ?? null,
      },
      flags: ["outbound_originated"],
      importance: 3,
    });

    revalidatePath("/comms");
    if (hcpCustomerId) revalidatePath(`/customer/${hcpCustomerId}`);
    if (hcpJobId) revalidatePath(`/job/${hcpJobId}`);
    return { ok: true, message: `text sent · ${phone.e164}`, sid: j.sid };
  }

  // mode === "call": queue a pending_phone_calls row
  // fire_at: ISO string. If empty, fire ASAP (now). The cron dispatcher polls every minute.
  const fireAt = fireAtRaw ? new Date(fireAtRaw).toISOString() : now;
  const dannyPhone = process.env.DANNY_PHONE_E164 ?? "";
  if (!dannyPhone) return { ok: false, message: "DANNY_PHONE_E164 not configured in dashboard env" };

  // The TwiML reads `text` aloud — include the vendor number + context.
  const reminderText = `Reminder to call ${phone.e164}. Context: ${body}`;
  const { data: pendingRow, error: insErr } = await supa
    .from("pending_phone_calls")
    .insert({
      to_phone: dannyPhone,             // call Danny first (he then calls vendor)
      fire_at: fireAt,
      reason: `vendor-callback-reminder:${writer.short_name}`,
      text: reminderText,
      voice: "Polly.Joanna",
      status: "pending",
      context_tag: `comms/new:${recipientType}`,
    })
    .select("id")
    .single();
  if (insErr) return { ok: false, message: `queue failed: ${insErr.message}` };

  // Emit communication_events placeholder so the planned callback shows up
  // in customer 360 + /ask. (occurred_at = fire_at — when it'll happen.)
  await supa.from("communication_events").insert({
    occurred_at: fireAt,
    channel: "call",
    direction: "outbound",
    hcp_customer_id: hcpCustomerId,
    hcp_employee_id: writer.emp_id,
    hcp_job_id: hcpJobId,
    tech_short_name: writer.short_name,
    counterparty: phone.e164,
    content_text: body,
    summary: `Queued callback: ${body.slice(0, 180)}`,
    source_table: "pending_phone_calls",
    source_id: String(pendingRow?.id ?? ""),
    raw_metadata: {
      queued_via: "dashboard:/comms/new",
      recipient_type: recipientType,
      pending_phone_call_id: pendingRow?.id ?? null,
      fire_at: fireAt,
    },
    flags: ["outbound_originated", "queued_callback"],
    importance: 4,
  });

  revalidatePath("/comms");
  if (hcpCustomerId) revalidatePath(`/customer/${hcpCustomerId}`);
  if (hcpJobId) revalidatePath(`/job/${hcpJobId}`);
  const when = fireAt === now ? "ASAP" : new Date(fireAt).toLocaleString();
  return { ok: true, message: `callback queued · fires ${when}`, queued_for: fireAt };
}
