"use server";

// Server actions for the unified team-notes capture (company whiteboard +
// person-to-person teammate notes). All access is service-role + scoped in
// app code: inbox reads are limited to the caller; whiteboard is company-wide.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
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
    .eq("target_email", me.email.toLowerCase())
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
    .eq("target_email", me.email.toLowerCase())
    .is("read_at", null);
  revalidatePath("/inbox");
  return { ok: true };
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
