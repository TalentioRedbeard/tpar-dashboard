// Resolve the signed-in user → tech_directory row.
// Used by /me, by Nav for role-based rendering, and by future scoped views.

import { db } from "./supabase";
import { getSessionUser } from "./supabase-server";
import { isAdmin } from "./admin";

export type DashboardRole = "admin" | "manager" | "tech" | null;

export type CurrentTech = {
  email: string;
  isAdmin: boolean;          // env-fallback OR dashboardRole === 'admin'
  isManager: boolean;        // dashboardRole === 'manager'
  canWrite: boolean;         // 'admin' or 'tech'; manager and unknown blocked
  dashboardRole: DashboardRole;
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
    .select("tech_id, tech_short_name, hcp_full_name, hcp_employee_id, is_active, slack_user_id, notes, email, secondary_emails, dashboard_role")
    .or(`email.ilike.${lowerEmail},secondary_emails.cs.{${lowerEmail}}`)
    .eq("is_active", true)
    .maybeSingle();

  const dashboardRole = ((data?.dashboard_role as string | null) ?? null) as DashboardRole;
  const envAdmin = isAdmin(user.email);
  const isAdminFinal = envAdmin || dashboardRole === "admin";
  const isManagerFinal = dashboardRole === "manager";
  // Writers can mutate state. Managers are read-only by design (see
  // 2026-05-01 from Danny). Unknown role = no writes either.
  const canWrite = isAdminFinal || dashboardRole === "tech";

  return {
    email: user.email,
    isAdmin: isAdminFinal,
    isManager: isManagerFinal,
    canWrite,
    dashboardRole,
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
//   "admin"   — full read+write
//   "manager" — full read, no writes
//   "tech"    — scoped to own work
//   "office"  — signed-in tulsapar.com but no tech row + no role
//   null      — not signed in
export type Role = "admin" | "manager" | "tech" | "office" | null;

export function roleFor(c: CurrentTech | null): Role {
  if (!c) return null;
  if (c.isAdmin) return "admin";
  if (c.isManager) return "manager";
  if (c.tech) return "tech";
  return "office";
}

/**
 * Server-action gate. Returns the email of the writer if allowed, or an
 * error string if blocked. Use at the top of every mutating server action:
 *
 *   const writer = await requireWriter();
 *   if (!writer.ok) return { ok: false, error: writer.error };
 *   // now use writer.email as the author
 *
 * Managers are explicitly blocked. Office (signed-in but unlabeled) is also
 * blocked — they should be assigned a dashboard_role before mutating.
 */
export async function requireWriter(): Promise<
  | { ok: true; email: string; role: "admin" | "tech" }
  | { ok: false; error: string }
> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  if (me.isAdmin) return { ok: true, email: me.email, role: "admin" };
  if (me.dashboardRole === "tech") return { ok: true, email: me.email, role: "tech" };
  if (me.isManager) {
    return { ok: false, error: "Managers are read-only on this dashboard. Ask Danny to take this action." };
  }
  return { ok: false, error: "Your account has no dashboard role assigned." };
}

// Shared helper: given the signed-in user and optional `?as=` override,
// return both the short name (matches communication_events.tech_short_name)
// and the full HCP name (matches job_360.tech_primary_name and
// appointments_master.tech_primary_name). Different surfaces match on
// different columns, so callers pick which one to use.
//
// Admins can impersonate any active tech via ?as=. Non-admin techs always
// see their own. Returns null if the caller isn't a tech (or admin view-as
// didn't resolve).
export async function getEffectiveTechName(
  asOverride: string | null
): Promise<{ shortName: string; fullName: string | null; viewingAs: string | null } | null> {
  const me = await getCurrentTech();
  if (!me) return null;

  if (asOverride && me.isAdmin) {
    const supa = db();
    const { data } = await supa
      .from("tech_directory")
      .select("tech_short_name, hcp_full_name")
      .ilike("tech_short_name", asOverride)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.tech_short_name) {
      return {
        shortName: data.tech_short_name as string,
        fullName: (data.hcp_full_name as string | null) ?? null,
        viewingAs: data.tech_short_name as string,
      };
    }
  }

  if (me.tech?.tech_short_name) {
    return {
      shortName: me.tech.tech_short_name,
      fullName: me.tech.hcp_full_name,
      viewingAs: null,
    };
  }
  return null;
}
