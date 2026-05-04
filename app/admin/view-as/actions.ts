"use server";

// Admin/manager-only "view as tech" impersonation actions.
// Sets a cookie that getCurrentTech() reads to pretend the signed-in user is
// a specific tech. Used by Danny + Kelsey + Madisson to preview the
// scope-limited tech dashboard architecture and offer guidance.

import { db } from "@/lib/supabase";
import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

const VIEW_AS_COOKIE = "tpar_view_as";

async function isLeadership(): Promise<boolean> {
  const user = await getSessionUser();
  if (!user?.email) return false;
  if (isAdmin(user.email)) return true;
  const supa = db();
  const { data } = await supa
    .from("tech_directory")
    .select("dashboard_role")
    .ilike("email", user.email)
    .eq("is_active", true)
    .maybeSingle();
  const role = data?.dashboard_role as string | null;
  return role === "admin" || role === "manager" || role === "production_manager";
}

export async function setViewAsTech(formData: FormData): Promise<void> {
  const techShortName = (formData.get("tech_short_name") as string | null)?.trim();
  if (!techShortName) return;
  if (!await isLeadership()) return;

  // Verify the tech exists + is active
  const supa = db();
  const { data } = await supa
    .from("tech_directory")
    .select("tech_short_name")
    .ilike("tech_short_name", techShortName)
    .eq("is_active", true)
    .maybeSingle();
  if (!data?.tech_short_name) return;

  const c = await cookies();
  c.set(VIEW_AS_COOKIE, data.tech_short_name as string, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours — long enough for a workday review session
  });
  revalidatePath("/", "layout");
  redirect("/");
}

export async function clearViewAsTech(): Promise<void> {
  const c = await cookies();
  c.delete(VIEW_AS_COOKIE);
  revalidatePath("/", "layout");
  redirect("/admin/view-as");
}
