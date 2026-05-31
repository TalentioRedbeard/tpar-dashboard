"use server";

// Per-dispatcher tech row order for /schedule (#21). Read/write the saved order
// (a list of hcp_full_names). Admin/manager only; keyed by the real signed-in
// email so impersonation doesn't change saved order.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export async function getTechOrder(): Promise<string[]> {
  const me = await getCurrentTech();
  if (!me || !(me.isAdmin || me.isManager)) return [];
  const { data } = await db().from("schedule_tech_order").select("tech_order").eq("user_email", me.realEmail).maybeSingle();
  return (data?.tech_order as string[] | undefined) ?? [];
}

export async function saveTechOrder(order: string[]): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech();
  if (!me || !(me.isAdmin || me.isManager)) return { ok: false, error: "dispatch role required" };
  const clean = order.filter((s) => typeof s === "string" && s.trim()).slice(0, 50);
  const { error } = await db().from("schedule_tech_order").upsert(
    { user_email: me.realEmail, tech_order: clean, updated_at: new Date().toISOString() },
    { onConflict: "user_email" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/schedule");
  return { ok: true };
}

export async function resetTechOrder(): Promise<{ ok: boolean }> {
  const me = await getCurrentTech();
  if (!me || !(me.isAdmin || me.isManager)) return { ok: false };
  await db().from("schedule_tech_order").delete().eq("user_email", me.realEmail);
  revalidatePath("/schedule");
  return { ok: true };
}
