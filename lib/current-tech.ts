// Resolve the signed-in user → tech_directory row.
// Used by /me, by Nav for role-based rendering, and by future scoped views.

import { db } from "./supabase";
import { getSessionUser } from "./supabase-server";
import { isAdmin } from "./admin";

export type CurrentTech = {
  email: string;
  isAdmin: boolean;
  tech: {
    tech_id: string;
    tech_short_name: string;
    hcp_full_name: string | null;
    hcp_employee_id: string | null;
    is_active: boolean;
    slack_user_id: string | null;
    notes: string | null;
  } | null;
};

export async function getCurrentTech(): Promise<CurrentTech | null> {
  const user = await getSessionUser();
  if (!user?.email) return null;

  const supa = db();
  const { data } = await supa
    .from("tech_directory")
    .select("tech_id, tech_short_name, hcp_full_name, hcp_employee_id, is_active, slack_user_id, notes")
    .ilike("email", user.email)
    .eq("is_active", true)
    .maybeSingle();

  return {
    email: user.email,
    isAdmin: isAdmin(user.email),
    tech: data ?? null,
  };
}

// Role label for nav rendering decisions.
//   "admin"   — DASHBOARD_ADMIN_EMAILS (full access)
//   "tech"    — has a tech_directory row matching email
//   "office"  — signed-in tulsapar.com but no tech row (Madisson, future hires)
//   null      — not signed in
export type Role = "admin" | "tech" | "office" | null;

export function roleFor(c: CurrentTech | null): Role {
  if (!c) return null;
  if (c.isAdmin) return "admin";
  if (c.tech) return "tech";
  return "office";
}
