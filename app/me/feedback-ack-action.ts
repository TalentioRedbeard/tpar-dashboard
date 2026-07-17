"use server";

// "Got it" on the /me Heard card (spec §3d): the tech acknowledges an answer
// and it collapses into history. Self-only by construction: real identity
// (never view-as — impersonation is rejected, matching requireSelf semantics)
// AND the item must belong to this tech. Read-only under view-as: the button
// is hidden client-side, and this gate holds regardless.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

export async function ackFeedbackItem(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech();
  if (!me?.tech) return { ok: false, error: "not signed in as a tech" };
  if (me.isImpersonating) return { ok: false, error: "Exit view-as — acknowledgements are the tech's own." };

  const { error } = await db()
    .from("feedback_items")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tech", me.tech.tech_short_name)   // self-scope: never ack someone else's
    .is("acknowledged_at", null);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/me");
  return { ok: true };
}
