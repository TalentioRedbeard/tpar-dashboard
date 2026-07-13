// Resolve the signed-in user → tech_directory row.
// Used by /me, by Nav for role-based rendering, and by future scoped views.

import { db } from "./supabase";
import { getSessionUser } from "./supabase-server";
import { isAdmin, isOwner } from "./admin";
import { toE164US } from "./phone";
import { cookies } from "next/headers";
import { cache } from "react";

export type DashboardRole = "admin" | "manager" | "production_manager" | "tech" | null;

// Personality levers stored in tech_directory.prefs (jsonb, merged writes via
// /settings). Honored by the AskBar (detail_level + processing_notes → answer
// style) and /me (simple_mode). Unknown keys pass through untouched.
export type TechPrefs = {
  detail_level?: "concise" | "standard" | "walkthrough";
  simple_mode?: boolean;
  wrap_reminder?: boolean;
  processing_notes?: string;
  [key: string]: unknown;
};

export type CurrentTech = {
  email: string;
  isAdmin: boolean;          // env-fallback OR dashboardRole === 'admin'
  isManager: boolean;        // dashboardRole === 'manager'
  canWrite: boolean;         // 'admin' or 'tech'; manager and unknown blocked
  dashboardRole: DashboardRole;
  isImpersonating: boolean;  // true if viewing-as another tech (admin/manager only)
  realRole: DashboardRole;   // the user's actual role (for banner display)
  realEmail: string;         // the user's actual email (for banner + exit)
  tech: {
    tech_id: string;
    tech_short_name: string;
    hcp_full_name: string | null;
    hcp_employee_id: string | null;
    is_active: boolean;
    is_lead: boolean;
    slack_user_id: string | null;
    notes: string | null;
    /** This tech's own directory email. Follows impersonation (= the
     *  viewed-as tech's email), so inbox/notes scope to the effective tech. */
    email: string | null;
    /** Per-user settings (see /settings). Default to current behavior. */
    gps_prompts_opt_out: boolean;
    hide_quick_recorder: boolean;
    default_landing: string | null;
    /** Personality levers (prefs jsonb) — always an object, never null. */
    prefs: TechPrefs;
  } | null;
};

// Normalize the raw jsonb into an always-an-object TechPrefs.
function toPrefs(v: unknown): TechPrefs {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as TechPrefs) : {};
}

const VIEW_AS_COOKIE = "tpar_view_as";

export const getCurrentTech = cache(async function getCurrentTech(): Promise<CurrentTech | null> {
  const user = await getSessionUser();
  if (!user || (!user.email && !user.phone)) return null;

  const supa = db();
  const COLS = "tech_id, tech_short_name, hcp_full_name, hcp_employee_id, is_active, is_lead, slack_user_id, notes, email, secondary_emails, dashboard_role, gps_prompts_opt_out, hide_quick_recorder, default_landing, prefs";

  // Resolve the tech_directory row by EMAIL (Google / magic-link) or, for
  // phone-OTP logins (field techs who sign in with a texted code), by PHONE.
  let data: Record<string, unknown> | null = null;
  if (user.email) {
    // Match on primary email OR any secondary email. Lowercase compare on both sides.
    const lowerEmail = user.email.toLowerCase();
    const res = await supa
      .from("tech_directory")
      .select(COLS)
      .or(`email.ilike.${lowerEmail},secondary_emails.cs.{${lowerEmail}}`)
      .eq("is_active", true)
      .maybeSingle();
    data = (res.data ?? null) as Record<string, unknown> | null;
  } else if (user.phone) {
    const e164 = toE164US(user.phone);
    if (e164) {
      const res = await supa
        .from("tech_directory")
        .select(COLS)
        .eq("phone", e164)
        .eq("is_active", true)
        .maybeSingle();
      data = (res.data ?? null) as Record<string, unknown> | null;
    }
  }

  // Stable identity used as me.email everywhere (durable author key + per-tech
  // read scoping). A phone-only tech with no real email gets a DETERMINISTIC
  // synthetic so the write author (me.email) and the read scope (me.tech.email)
  // always agree. Must never resemble an allow-listed address (it never gains
  // admin/owner — correct for a tech).
  const phoneE164 = user.phone ? toE164US(user.phone) : null;
  const syntheticEmail = phoneE164 ? `${phoneE164.replace(/\D/g, "")}@phone.tpar.local` : null;
  const identityEmail = (user.email ?? (data?.email as string | null) ?? syntheticEmail ?? user.id) as string;

  const dashboardRole = ((data?.dashboard_role as string | null) ?? null) as DashboardRole;
  const envAdmin = isAdmin(user.email);
  const isAdminFinal = envAdmin || dashboardRole === "admin";
  // Production manager is manager-tier auth for v0 (per Danny 2026-05-04). Will refine
  // as the role separates from Owner per ROLES_AND_PROTOCOLS.md.
  const isManagerFinal = dashboardRole === "manager" || dashboardRole === "production_manager";
  // Writers can mutate state. Managers are read-only by design (see
  // 2026-05-01 from Danny). Unknown role = no writes either.
  const canWrite = isAdminFinal || dashboardRole === "tech";

  // ── View-as tech impersonation (admin/manager only) ─────────────────
  // Per Danny 2026-05-04: leadership wants to preview the tech dashboard
  // architecture to offer guidance. Cookie set via /admin/view-as.
  if (isAdminFinal || isManagerFinal) {
    const viewAsName = (await cookies()).get(VIEW_AS_COOKIE)?.value;
    if (viewAsName && viewAsName.trim()) {
      const { data: targetTech } = await supa
        .from("tech_directory")
        .select("tech_id, tech_short_name, hcp_full_name, hcp_employee_id, is_active, is_lead, slack_user_id, notes, email, gps_prompts_opt_out, hide_quick_recorder, default_landing, prefs")
        .ilike("tech_short_name", viewAsName.trim())
        .eq("is_active", true)
        .maybeSingle();
      if (targetTech?.tech_short_name) {
        // Render as if signed in as this tech. Auth tier downgrades to 'tech'
        // so the impersonator sees exactly what the real tech would see —
        // including the scope-limited home page + URL-scope auth on /job + /customer.
        return {
          email: identityEmail,                       // keep real identity so action audit trails work
          isAdmin: false,
          isManager: false,
          canWrite: true,
          dashboardRole: "tech",
          isImpersonating: true,
          realRole: dashboardRole,
          realEmail: identityEmail,
          tech: {
            tech_id: targetTech.tech_id as string,
            tech_short_name: targetTech.tech_short_name as string,
            hcp_full_name: targetTech.hcp_full_name as string | null,
            hcp_employee_id: targetTech.hcp_employee_id as string | null,
            is_active: targetTech.is_active as boolean,
            is_lead: !!(targetTech.is_lead as boolean | null),
            slack_user_id: targetTech.slack_user_id as string | null,
            notes: targetTech.notes as string | null,
            email: (targetTech.email as string | null) ?? null,
            gps_prompts_opt_out: !!(targetTech.gps_prompts_opt_out as boolean | null),
            hide_quick_recorder: !!(targetTech.hide_quick_recorder as boolean | null),
            default_landing: (targetTech.default_landing as string | null) ?? null,
            prefs: toPrefs((targetTech as Record<string, unknown>).prefs),
          },
        };
      }
    }
  }

  return {
    email: identityEmail,
    isAdmin: isAdminFinal,
    isManager: isManagerFinal,
    canWrite,
    dashboardRole,
    isImpersonating: false,
    realRole: dashboardRole,
    realEmail: identityEmail,
    tech: data ? {
      tech_id: data.tech_id as string,
      tech_short_name: data.tech_short_name as string,
      hcp_full_name: data.hcp_full_name as string | null,
      hcp_employee_id: data.hcp_employee_id as string | null,
      is_active: data.is_active as boolean,
      is_lead: !!(data.is_lead as boolean | null),
      slack_user_id: data.slack_user_id as string | null,
      notes: data.notes as string | null,
      // Phone-only techs have no DB email; fall back to the synthetic identity
      // so per-tech reads (me.tech.email) match write authorship (me.email).
      email: (data.email as string | null) ?? (user.email ? null : identityEmail),
      gps_prompts_opt_out: !!(data.gps_prompts_opt_out as boolean | null),
      hide_quick_recorder: !!(data.hide_quick_recorder as boolean | null),
      default_landing: (data.default_landing as string | null) ?? null,
      prefs: toPrefs(data.prefs),
    } : null,
  };
});

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
 * UI mirror of requireResolver(): can this user ack/resolve a
 * communication_event? Keep in lockstep with requireResolver() so the
 * AckButton control matches the server gate (admin || tech || manager).
 */
export function canResolveComms(c: CurrentTech | null): boolean {
  if (!c) return false;
  return c.isAdmin || c.isManager || c.dashboardRole === "tech";
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
    // Managers are read-only for *authorship* writes (notes). Their allowed
    // operational actions (acking comms, booking work) go through
    // requireResolver()/requireScheduler() below. Per Danny 2026-05-30.
    return { ok: false, error: "This action is limited to the owner or a tech." };
  }
  return { ok: false, error: "Your account has no dashboard role assigned." };
}

/**
 * Self gate — for a user editing THEIR OWN profile/settings (the /settings page).
 * Distinct from requireWriter() (which blocks managers): every signed-in person
 * with a tech_directory row may change their own preferences, including managers.
 * Blocked while impersonating (view-as) so an admin can't accidentally rewrite the
 * viewed tech's settings row. Returns the resolved CurrentTech so the caller can
 * scope the write by me.tech.tech_id — the ONLY ownership boundary (no RLS).
 */
export async function requireSelf(): Promise<
  | { ok: true; me: CurrentTech }
  | { ok: false; error: string }
> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  if (me.isImpersonating) return { ok: false, error: "Exit view-as to change your own settings." };
  if (!me.tech) return { ok: false, error: "Your account isn't linked to a tech profile yet — ask Danny." };
  return { ok: true, me };
}

/**
 * Resolver gate — for operational "resolve/triage" actions that managers MAY
 * take (acking a communication_event). Distinct from requireWriter() (note
 * authorship) which keeps managers out. Per Danny 2026-05-30: Madisson is a
 * first-class resolver of inbound comms. Admin, tech, and manager pass.
 */
export async function requireResolver(): Promise<
  | { ok: true; email: string; role: "admin" | "tech" | "manager" }
  | { ok: false; error: string }
> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  if (me.isAdmin) return { ok: true, email: me.email, role: "admin" };
  if (me.dashboardRole === "tech") return { ok: true, email: me.email, role: "tech" };
  if (me.isManager) return { ok: true, email: me.email, role: "manager" };
  return { ok: false, error: "Your account has no dashboard role assigned." };
}

/**
 * Scheduler gate — for creating customer-facing work (jobs/events/estimates)
 * from /dispatch. Per Danny 2026-05-30: managers (Madisson) book work; techs
 * do not. Kept as its own gate so a future "standardize on requireWriter"
 * refactor can't silently revoke the office's ability to schedule.
 */
export async function requireScheduler(): Promise<
  | { ok: true; email: string; role: "admin" | "manager" }
  | { ok: false; error: string }
> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  if (me.isAdmin) return { ok: true, email: me.email, role: "admin" };
  if (me.isManager) return { ok: true, email: me.email, role: "manager" };
  return { ok: false, error: "Only the owner or a manager can create scheduled work." };
}

/**
 * Management gate — the /manage control panel and every mutating server
 * action under it (build plan 2026-07-13, section 2.1). Admin + manager tier
 * (isManager already covers production_manager). Impersonation is EXPLICITLY
 * blocked: view-as downgrades the session to tech so the panel naturally
 * vanishes, and this check guarantees no management write can ever run while
 * viewing-as (the audit trail must name the real actor acting as themselves).
 */
export async function requireManagement(): Promise<
  | { ok: true; email: string; role: "admin" | "manager" }
  | { ok: false; error: string }
> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  if (me.isImpersonating) return { ok: false, error: "Exit view-as to use management tools." };
  if (me.isAdmin) return { ok: true, email: me.email, role: "admin" };
  if (me.isManager) return { ok: true, email: me.email, role: "manager" };
  return { ok: false, error: "Management access only." };
}

/**
 * Sender gate — customer-facing document sends (estimates now, invoices later).
 * Decision #4 (plan 2026-07-13): admin and managers may send ANY estimate or
 * invoice; a tech may send only for work they are scheduled to
 * (appointments_master match on hcp_employee_id — matching by name invites the
 * second-Chris collision). No job/appointment linkage → manager/admin only.
 * Impersonation blocked: a customer-facing send must name the real actor.
 */
export async function requireSender(link: {
  hcpJobId?: string | null;
  hcpEstimateId?: string | null;
}): Promise<
  | { ok: true; email: string; role: "admin" | "manager" | "tech" }
  | { ok: false; error: string }
> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  if (me.isImpersonating) return { ok: false, error: "Exit view-as to send to a customer." };
  if (me.isAdmin) return { ok: true, email: me.email, role: "admin" };
  if (me.isManager) return { ok: true, email: me.email, role: "manager" };
  if (me.dashboardRole === "tech") {
    const empId = me.tech?.hcp_employee_id ?? null;
    if (!empId) return { ok: false, error: "Your profile isn't linked to an HCP employee yet — ask Danny." };
    const ors: string[] = [];
    if (link.hcpJobId) ors.push(`hcp_job_id.eq.${link.hcpJobId}`);
    if (link.hcpEstimateId) ors.push(`hcp_estimate_id.eq.${link.hcpEstimateId}`);
    if (ors.length === 0) {
      return { ok: false, error: "This isn't linked to scheduled work — ask a manager to send it." };
    }
    const { data } = await db()
      .from("appointments_master")
      .select("id")
      .or(ors.join(","))
      .contains("tech_all_ids", [empId])
      .limit(1)
      .maybeSingle();
    if (data) return { ok: true, email: me.email, role: "tech" };
    return { ok: false, error: "Only techs scheduled to this work (or a manager) can send it." };
  }
  return { ok: false, error: "Your account has no dashboard role assigned." };
}

/**
 * Owner-only server-action gate. Stricter than requireWriter() — passes only
 * for the owner account, not other admins. Use for capabilities reserved to
 * the owner (e.g. editing the global "?" help content).
 */
export async function requireOwner(): Promise<
  | { ok: true; email: string }
  | { ok: false; error: string }
> {
  const user = await getSessionUser();
  if (!user?.email) return { ok: false, error: "not signed in" };
  if (!isOwner(user.email)) return { ok: false, error: "Only the owner can do this." };
  return { ok: true, email: user.email };
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
