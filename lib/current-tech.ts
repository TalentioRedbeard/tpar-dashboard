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
  // Match on primary email OR any secondary email. Lowercase compare on both sides.
  const lowerEmail = user.email.toLowerCase();
  const { data } = await supa
    .from("tech_directory")
    .select("tech_id, tech_short_name, hcp_full_name, hcp_employee_id, is_active, slack_user_id, notes, email, secondary_emails")
    .or(`email.ilike.${lowerEmail},secondary_emails.cs.{${lowerEmail}}`)
    .eq("is_active", true)
    .maybeSingle();

  return {
    email: user.email,
    isAdmin: isAdmin(user.email),
    tech: data ? {
      tech_id: data.tech_id as string,
      tech_short_name: data.tech_short_name as string,
      hcp_full_name: data.hcp_full_name as string | null,
      hcp_employee_id: data.hcp_employee_id as string | null,
      is_active: data.is_active as boolean,
      slack_user_id: data.slack_user_id as string | null,
      notes: data.notes as string | null,
    } : null,
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

// Shared helper: given the signed-in user and optional `?as=` override,
// return the tech_short_name that "mine" filters should use. Admins can
// impersonate any active tech via ?as=. Non-admin techs always see their
// own. Returns null if the caller isn't a tech (or admin view-as didn't
// resolve).
export async function getEffectiveTechName(
  asOverride: string | null
): Promise<{ techName: string; viewingAs: string | null } | null> {
  const me = await getCurrentTech();
  if (!me) return null;

  if (asOverride && me.isAdmin) {
    const supa = db();
    const { data } = await supa
      .from("tech_directory")
      .select("tech_short_name")
      .ilike("tech_short_name", asOverride)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.tech_short_name) {
      return { techName: data.tech_short_name as string, viewingAs: data.tech_short_name as string };
    }
  }

  if (me.tech?.tech_short_name) {
    return { techName: me.tech.tech_short_name, viewingAs: null };
  }
  return null;
}
