"use server";

// Server actions for the unified team-notes capture (company whiteboard +
// person-to-person teammate notes). All access is service-role + scoped in
// app code: inbox reads are limited to the caller; whiteboard is company-wide.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getCurrentTech, requireOwner } from "@/lib/current-tech";
import { isOwner } from "@/lib/admin";

export type Recipient = { email: string; label: string };

export type BoardNote = {
  id: string;
  author_email: string;
  author_short_name: string | null;
  target_kind: "whiteboard" | "teammate";
  target_email: string | null;
  target_short_name: string | null;
  body: string;
  attach_kind: "job" | "customer" | "estimate" | "url" | null;
  attach_ref: string | null;
  tags: string[];
  urgent: boolean;
  created_at: string;
  read_at: string | null;
};

export type PostResult = { ok: true; message: string } | { ok: false; message: string };

// The email an inbox/notes view should scope to. Follows "view as" — when an
// admin is impersonating a tech, this is the impersonated tech's email, so the
// inbox shows THAT tech's notes. Falls back to the real signed-in email.
type Me = NonNullable<Awaited<ReturnType<typeof getCurrentTech>>>;
function effectiveEmail(me: Me): string {
  return (me.tech?.email ?? me.email).toLowerCase();
}

export async function listRecipients(): Promise<Recipient[]> {
  const me = await getCurrentTech();
  if (!me) return [];
  const { data } = await db()
    .from("tech_directory")
    .select("tech_short_name, hcp_full_name, email")
    .eq("is_active", true)
    .not("email", "is", null)
    .order("tech_short_name");
  const meLower = me.email.toLowerCase();
  return (data ?? [])
    .filter((r) => r.email && String(r.email).toLowerCase() !== meLower)
    .map((r) => ({
      email: String(r.email).toLowerCase(),
      label: (r.tech_short_name as string) || (r.hcp_full_name as string) || String(r.email),
    }));
}

export async function listWhiteboard(limit = 50): Promise<BoardNote[]> {
  const me = await getCurrentTech();
  if (!me) return [];
  const { data } = await db()
    .from("team_notes")
    .select("*")
    .eq("target_kind", "whiteboard")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as BoardNote[];
}

export async function listMyInbox(): Promise<BoardNote[]> {
  const me = await getCurrentTech();
  if (!me) return [];
  const { data } = await db()
    .from("team_notes")
    .select("*")
    .eq("target_kind", "teammate")
    .eq("target_email", effectiveEmail(me))
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []) as BoardNote[];
}

export async function markNoteRead(id: string): Promise<{ ok: boolean }> {
  const me = await getCurrentTech();
  if (!me) return { ok: false };
  await db()
    .from("team_notes")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("target_email", effectiveEmail(me))
    .is("read_at", null);
  revalidatePath("/inbox");
  return { ok: true };
}

// Count of unread inbox notes + unseen whiteboard posts for the nav badges.
// Scoped to the effective (impersonation-aware) identity.
export async function getUnreadCounts(): Promise<{ inbox: number; board: number }> {
  const me = await getCurrentTech();
  if (!me) return { inbox: 0, board: 0 };
  const email = effectiveEmail(me);

  const { count: inbox } = await db()
    .from("team_notes")
    .select("id", { count: "exact", head: true })
    .eq("target_kind", "teammate")
    .eq("target_email", email)
    .is("read_at", null);

  const { data: seen } = await db()
    .from("whiteboard_views")
    .select("last_seen_at")
    .eq("user_email", email)
    .maybeSingle();
  const since = (seen?.last_seen_at as string | undefined) ?? "1970-01-01T00:00:00Z";

  const { count: board } = await db()
    .from("team_notes")
    .select("id", { count: "exact", head: true })
    .eq("target_kind", "whiteboard")
    .gt("created_at", since)
    .neq("author_email", email);

  return { inbox: inbox ?? 0, board: board ?? 0 };
}

// Mark the whiteboard "seen" up to now for the current user. Skipped while
// impersonating so previewing a tech's view doesn't clear THEIR badge.
export async function markWhiteboardSeen(): Promise<{ ok: boolean }> {
  const me = await getCurrentTech();
  if (!me || me.isImpersonating) return { ok: false };
  await db()
    .from("whiteboard_views")
    .upsert({ user_email: effectiveEmail(me), last_seen_at: new Date().toISOString() }, { onConflict: "user_email" });
  return { ok: true };
}

// ── SMS notifications ──────────────────────────────────────────────────────

// Master switch — gates ALL outbound SMS. Ships OFF; only the owner flips it.
export async function getSmsEnabled(): Promise<boolean> {
  const { data } = await db().from("app_flags").select("enabled").eq("key", "sms_notifications").maybeSingle();
  return !!data?.enabled;
}

export async function setSmsEnabled(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };
  const { error } = await db()
    .from("app_flags")
    .upsert({ key: "sms_notifications", enabled, updated_by: owner.email, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/inbox");
  return { ok: true };
}

// Per-person opt-out (default opted-in). Set for the real signed-in user.
export async function getMySmsOptOut(): Promise<boolean> {
  const me = await getCurrentTech();
  if (!me) return false;
  const { data } = await db().from("tech_directory").select("sms_opt_out").or(`email.ilike.${me.email.toLowerCase()},secondary_emails.cs.{${me.email.toLowerCase()}}`).maybeSingle();
  return !!data?.sms_opt_out;
}

// setMySmsOptOut was RETIRED 2026-07-17 (hygiene, feedback-loop spec §1): it
// wrote tech_directory by email-ilike with no self gate — under view-as it
// edited the wrong row. The one true setter is updateMySettings on /settings
// (requireSelf + tech_id-scoped + strict whitelist).

// Quiet hours: 9pm–7am America/Chicago — no texts sent in this window.
function inQuietHours(): boolean {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", hour12: false }).format(new Date()));
  return h >= 21 || h < 7;
}

// Best-effort SMS to a teammate when a note is addressed to them. Sends ONLY
// when the master switch is on, the recipient has a phone, hasn't opted out,
// and it isn't quiet hours. Never throws.
async function maybeSendSms(targetEmail: string, fromName: string, body: string, urgent: boolean): Promise<void> {
  try {
    if (!(await getSmsEnabled())) return;
    if (inQuietHours()) return;
    const { data: rt } = await db()
      .from("tech_directory")
      .select("phone, sms_opt_out")
      .or(`email.ilike.${targetEmail},secondary_emails.cs.{${targetEmail}}`)
      .eq("is_active", true)
      .maybeSingle();
    const phone = (rt?.phone as string | null) ?? null;
    if (!phone || rt?.sms_opt_out) return;

    const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    const text = `${urgent ? "🚨 URGENT — " : ""}New note from ${fromName} on TPAR:\n\n"${body.slice(0, 280)}${body.length > 280 ? "…" : ""}"\n\nOpen: https://tpar-dashboard.vercel.app/inbox`;
    await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ to: phone, text, context: "team-note" }),
    });
  } catch { /* best-effort */ }
}

export async function postNote(_prev: PostResult, formData: FormData): Promise<PostResult> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, message: "not signed in" };

  const targetKind = String(formData.get("target_kind") ?? "");
  if (targetKind !== "whiteboard" && targetKind !== "teammate") {
    return { ok: false, message: "Pick a destination." };
  }

  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { ok: false, message: "Note can't be empty." };
  if (body.length > 5000) return { ok: false, message: "Note too long (5000 char max)." };

  const urgent = formData.get("urgent") === "1";
  const tagsRaw = String(formData.get("tags") ?? "").trim();
  const tags = tagsRaw ? tagsRaw.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [];

  const attachKindRaw = String(formData.get("attach_kind") ?? "").trim();
  const attachRef = String(formData.get("attach_ref") ?? "").trim() || null;
  const attachKind = ["job", "customer", "estimate", "url"].includes(attachKindRaw) ? attachKindRaw : null;
  const hasAttach = !!(attachKind && attachRef);

  let targetEmail: string | null = null;
  let targetShort: string | null = null;
  if (targetKind === "teammate") {
    targetEmail = String(formData.get("target_email") ?? "").trim().toLowerCase() || null;
    if (!targetEmail) return { ok: false, message: "Pick who it's for." };
    const { data: t } = await db()
      .from("tech_directory")
      .select("tech_short_name")
      .or(`email.ilike.${targetEmail},secondary_emails.cs.{${targetEmail}}`)
      .eq("is_active", true)
      .maybeSingle();
    targetShort = (t?.tech_short_name as string) ?? null;
  }

  const { error } = await db().from("team_notes").insert({
    author_email: me.email,
    author_short_name: me.tech?.tech_short_name ?? null,
    target_kind: targetKind,
    target_email: targetEmail,
    target_short_name: targetShort,
    body,
    attach_kind: hasAttach ? attachKind : null,
    attach_ref: hasAttach ? attachRef : null,
    tags,
    urgent,
  });
  if (error) return { ok: false, message: error.message };

  // Best-effort SMS to the recipient (gated by master switch + opt-out + quiet hours).
  if (targetKind === "teammate" && targetEmail) {
    const fromName = me.tech?.tech_short_name ?? me.email.split("@")[0];
    await maybeSendSms(targetEmail, fromName, body, urgent);
  }

  // Best-effort Slack ping to Danny when a teammate note is addressed to him.
  if (targetKind === "teammate" && targetEmail && isOwner(targetEmail)) {
    try {
      const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const asker = me.tech?.tech_short_name ?? me.email.split("@")[0];
      const mark = urgent ? "🚨 *URGENT* " : "📬 ";
      const attachLine = hasAttach ? `\n_attached ${attachKind}: ${attachRef}_` : "";
      const text = `${mark}*Note for you from ${asker}*\n\n${body.slice(0, 1500)}${body.length > 1500 ? "…" : ""}${attachLine}\n\n<https://tpar-dashboard.vercel.app/inbox|Open inbox>`;
      await fetch(`${SUPABASE_URL}/functions/v1/notify-danny`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Trigger-Secret": process.env.NOTIFY_DANNY_SECRET ?? "" },
        body: JSON.stringify({ text, context: "team-note" }),
      });
    } catch { /* best-effort */ }
  }

  revalidatePath("/whiteboard");
  revalidatePath("/inbox");
  return { ok: true, message: targetKind === "whiteboard" ? "Posted to the whiteboard." : "Sent." };
}
