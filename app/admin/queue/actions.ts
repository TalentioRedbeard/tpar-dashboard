"use server";

// Server actions for /admin/queue (email Phase 0 triage).
//
// All writes go through the service-role client and stamp acked_by with the
// user's email so we have an audit trail.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";

export type AckDisposition = "actioned" | "handled_elsewhere" | "dismissed_noise" | "bulk_swept";

export type AckResult =
  | { ok: null }
  | { ok: true; message: string }
  | { ok: false; message: string };

async function requireAdmin(): Promise<{ email: string } | null> {
  const user = await getSessionUser();
  if (!user || !user.email || !isAdmin(user.email)) return null;
  return { email: user.email };
}

export async function ackEvent(_prev: AckResult, formData: FormData): Promise<AckResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, message: "not authorized" };

  const id = String(formData.get("id") ?? "").trim();
  const kind = String(formData.get("kind") ?? "event").trim();   // 'event' (communication_events) | 'email' (emails_received)
  const dispositionRaw = String(formData.get("disposition") ?? "").trim();
  const valid: AckDisposition[] = ["actioned", "handled_elsewhere", "dismissed_noise"];
  if (!id) return { ok: false, message: "missing id" };
  if (!valid.includes(dispositionRaw as AckDisposition)) {
    return { ok: false, message: `invalid disposition: ${dispositionRaw}` };
  }
  if (!["event", "email"].includes(kind)) {
    return { ok: false, message: `invalid kind: ${kind}` };
  }

  const table = kind === "email" ? "emails_received" : "communication_events";
  const supa = db();

  // For emails: pre-fetch gmail_message_id so we can archive in Gmail
  // after the ack succeeds. Best-effort — Gmail failure doesn't block ack.
  let gmailMessageId: string | null = null;
  if (kind === "email") {
    const { data } = await supa
      .from("emails_received")
      .select("gmail_message_id")
      .eq("id", id)
      .maybeSingle();
    gmailMessageId = (data as { gmail_message_id?: string } | null)?.gmail_message_id ?? null;
  }

  const { error } = await supa
    .from(table)
    .update({
      acked_at: new Date().toISOString(),
      acked_by: me.email,
      acked_disposition: dispositionRaw,
    })
    .eq("id", id)
    .is("acked_at", null);   // protect against double-ack races

  if (error) return { ok: false, message: error.message };

  // Archive the email in Gmail itself (gmail.modify scope was added 2026-05-08).
  // Any disposition triggers archive — once you've dealt with an email, it
  // doesn't need to be in the inbox anymore. Failures log but don't block UX.
  let gmailNote = "";
  if (kind === "email" && gmailMessageId) {
    try {
      const r = await fetch(
        "https://bwpoqsfrygyopwxmegax.functions.supabase.co/gmail-modify",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ gmail_message_id: gmailMessageId, action: "archive" }),
        },
      );
      if (r.ok) gmailNote = " · archived";
      else gmailNote = ` · archive failed (${r.status})`;
    } catch (e) {
      gmailNote = ` · archive error`;
      console.error("gmail-modify call failed:", e);
    }
  }

  revalidatePath("/admin/queue");
  const baseMsg = dispositionRaw === "actioned" ? "✓ done" : dispositionRaw === "handled_elsewhere" ? "✓ handled" : "✓ dismissed";
  return { ok: true, message: baseMsg + gmailNote };
}

export type BulkResult = { ok: boolean; swept: number; message: string };

// Bulk-sweep low-importance items older than `older_than_days` days.
// Default: importance <= 6, age > 7 days.
export async function bulkSweepLowImportance(formData: FormData): Promise<BulkResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, swept: 0, message: "not authorized" };

  const maxImp = Number(formData.get("max_importance") ?? 6);
  const olderThanDays = Number(formData.get("older_than_days") ?? 7);
  if (!Number.isFinite(maxImp) || !Number.isFinite(olderThanDays)) {
    return { ok: false, swept: 0, message: "invalid params" };
  }

  const supa = db();
  const cutoffIso = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const { data, error } = await supa
    .from("communication_events")
    .update({
      acked_at: new Date().toISOString(),
      acked_by: me.email,
      acked_disposition: "bulk_swept",
    })
    .lte("importance", maxImp)
    .lt("occurred_at", cutoffIso)
    .is("acked_at", null)
    .overlaps("flags", ["needs_followup", "unresolved", "escalation_needed"])
    .select("id");

  if (error) return { ok: false, swept: 0, message: error.message };
  const swept = (data ?? []).length;

  revalidatePath("/admin/queue");
  return { ok: true, swept, message: `✓ swept ${swept} items` };
}
