"use server";

// Per-user Settings (2026-06-18). Backs /settings. Every signed-in person with a
// tech_directory row edits THEIR OWN row — scoped by me.tech.tech_id, which is the
// entire ownership boundary (tech_directory has RLS enabled but no policies; the
// dashboard's db() is service_role and bypasses it). So: requireSelf() gates, the
// write is .eq('tech_id', me.tech.tech_id), and ONLY whitelisted preference columns
// are ever touched — role/email/secondary_emails/is_active are never writable here
// (that would be privilege-escalation / identity-rebind). Owner-only globals
// (customer-SMS master, phone-OTP login) live in app_flags behind requireOwner.

import { db } from "@/lib/supabase";
import { getCurrentTech, requireSelf, requireOwner } from "@/lib/current-tech";
import { isOwner } from "@/lib/admin";
import { revalidatePath } from "next/cache";

// Routes a user may choose to land on after login. Excludes "/" (would loop) and
// any non-page route. Leadership-only routes are still accepted server-side — if a
// tech picks one the page-level gate just bounces them to /me (no loop), but the
// form only OFFERS role-appropriate routes.
const LANDING_ALLOW = new Set<string>([
  "/me", "/dispatch", "/schedule", "/jobs", "/customers", "/comms", "/gallery", "/shopping", "/reports",
]);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Personality levers (2026-07-05) — stored in tech_directory.prefs (jsonb).
// These are HONORED, not decorative: detail_level + processing_notes shape the
// page-aware ask (app/ask/bar-action.ts); simple_mode reshapes /me; wrap_reminder
// gates the end-of-day Daily Wrap nudge. Writes MERGE into prefs — unknown keys
// other features may add are never clobbered.
// (not exported — "use server" files may only value-export async functions)
const DETAIL_LEVELS = ["concise", "standard", "walkthrough"] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];
const PROCESSING_NOTES_MAX = 500;

export type MySettings = {
  hasTech: boolean;
  isImpersonating: boolean;
  isOwner: boolean;
  dashboardRole: string | null;
  // per-user
  sms_opt_out: boolean;
  eod_dm_opt_out: boolean;
  gps_prompts_opt_out: boolean;
  hide_quick_recorder: boolean;
  color_hex: string | null;
  default_landing: string | null;
  avatar_url: string | null;
  techShortName: string | null;
  // personality levers (from prefs jsonb)
  detail_level: DetailLevel;
  simple_mode: boolean;
  wrap_reminder: boolean;
  feedback_dm_opt_out: boolean;
  processing_notes: string;
  // trust line (spec §1): answers this tech received in the last 30 days
  feedbackAnswered30d: number;
  // owner-only globals
  smsMaster: boolean;
  phoneLogin: boolean;
};

export async function getMySettings(): Promise<MySettings | null> {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return null;
  const supa = db();

  let row: Record<string, unknown> | null = null;
  let feedbackAnswered30d = 0;
  if (me.tech) {
    const [rowRes, fbRes] = await Promise.all([
      supa
        .from("tech_directory")
        .select("tech_short_name, sms_opt_out, eod_dm_opt_out, gps_prompts_opt_out, hide_quick_recorder, color_hex, default_landing, avatar_url, prefs")
        .eq("tech_id", me.tech.tech_id)
        .maybeSingle(),
      supa
        .from("feedback_items")
        .select("id", { count: "exact", head: true })
        .eq("tech", me.tech.tech_short_name)
        .not("responded_at", "is", null)
        .gte("responded_at", new Date(Date.now() - 30 * 86_400_000).toISOString()),
    ]);
    row = (rowRes.data ?? null) as Record<string, unknown> | null;
    feedbackAnswered30d = fbRes.count ?? 0;
  }

  const owner = isOwner(me.realEmail);
  let smsMaster = false;
  let phoneLogin = false;
  if (owner) {
    const { data: flags } = await supa.from("app_flags").select("key, enabled").in("key", ["sms_notifications", "phone_login_enabled"]);
    for (const f of (flags ?? []) as Array<{ key: string; enabled: boolean }>) {
      if (f.key === "sms_notifications") smsMaster = !!f.enabled;
      if (f.key === "phone_login_enabled") phoneLogin = !!f.enabled;
    }
  }

  const prefs = (row?.prefs && typeof row.prefs === "object" ? row.prefs : {}) as Record<string, unknown>;

  return {
    hasTech: !!me.tech,
    isImpersonating: me.isImpersonating,
    isOwner: owner,
    dashboardRole: me.dashboardRole,
    sms_opt_out: !!(row?.sms_opt_out as boolean | null),
    eod_dm_opt_out: !!(row?.eod_dm_opt_out as boolean | null),
    gps_prompts_opt_out: !!(row?.gps_prompts_opt_out as boolean | null),
    hide_quick_recorder: !!(row?.hide_quick_recorder as boolean | null),
    color_hex: (row?.color_hex as string | null) ?? null,
    default_landing: (row?.default_landing as string | null) ?? null,
    avatar_url: (row?.avatar_url as string | null) ?? null,
    techShortName: (row?.tech_short_name as string | null) ?? me.tech?.tech_short_name ?? null,
    detail_level: DETAIL_LEVELS.includes(prefs.detail_level as DetailLevel) ? (prefs.detail_level as DetailLevel) : "standard",
    // Mirror toPrefs' role-aware default (A9): an untouched tech shows the
    // EFFECTIVE state (on). Without this, /settings would show OFF while /me
    // renders simple — and the next incidental Save (SettingsForm always sends
    // simple_mode) would write false and silently kill the default.
    simple_mode: typeof prefs.simple_mode === "boolean" ? prefs.simple_mode : me.dashboardRole === "tech",
    wrap_reminder: prefs.wrap_reminder === true,
    // absent = DMs ON (answers reach the tech unless they said otherwise)
    feedback_dm_opt_out: prefs.feedback_dm_opt_out === true,
    processing_notes: typeof prefs.processing_notes === "string" ? prefs.processing_notes : "",
    feedbackAnswered30d,
    smsMaster,
    phoneLogin,
  };
}

export async function updateMySettings(input: {
  sms_opt_out?: boolean;
  eod_dm_opt_out?: boolean;
  gps_prompts_opt_out?: boolean;
  hide_quick_recorder?: boolean;
  color_hex?: string | null;
  default_landing?: string | null;
  avatar_url?: string | null;
  // personality levers → merged into prefs jsonb (never clobbers unknown keys)
  detail_level?: DetailLevel;
  simple_mode?: boolean;
  wrap_reminder?: boolean;
  feedback_dm_opt_out?: boolean;
  processing_notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const self = await requireSelf();
  if (!self.ok) return { ok: false, error: self.error };
  const techId = self.me.tech!.tech_id; // requireSelf guarantees a tech row

  // Build a STRICT whitelist patch — never spread client input.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof input.sms_opt_out === "boolean") patch.sms_opt_out = input.sms_opt_out;
  if (typeof input.eod_dm_opt_out === "boolean") patch.eod_dm_opt_out = input.eod_dm_opt_out;
  if (typeof input.gps_prompts_opt_out === "boolean") patch.gps_prompts_opt_out = input.gps_prompts_opt_out;
  if (typeof input.hide_quick_recorder === "boolean") patch.hide_quick_recorder = input.hide_quick_recorder;

  if (input.color_hex !== undefined) {
    const c = (input.color_hex ?? "").trim();
    if (c === "") patch.color_hex = null;
    else if (HEX_RE.test(c)) patch.color_hex = c.toLowerCase();
    else return { ok: false, error: "Color must be a hex value like #1e40af." };
  }
  if (input.default_landing !== undefined) {
    const d = (input.default_landing ?? "").trim();
    if (d === "") patch.default_landing = null;
    else if (LANDING_ALLOW.has(d)) patch.default_landing = d;
    else return { ok: false, error: "That landing page isn't allowed." };
  }
  if (input.avatar_url !== undefined) {
    const a = (input.avatar_url ?? "").trim();
    if (a === "") patch.avatar_url = null;
    // Only our own avatars bucket — never an arbitrary URL onto a rendered <img>.
    else if (a.startsWith(`${process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/`)) patch.avatar_url = a;
    else return { ok: false, error: "Avatar must come from the in-app uploader." };
  }

  // Personality levers → prefs jsonb. Whitelisted keys only, MERGED over the
  // row's current prefs (read-then-write; single-owner row, so no real race).
  // Unknown keys other features stash in prefs survive untouched.
  const prefsPatch: Record<string, unknown> = {};
  if (input.detail_level !== undefined) {
    if (!DETAIL_LEVELS.includes(input.detail_level)) return { ok: false, error: "Unknown detail level." };
    prefsPatch.detail_level = input.detail_level;
  }
  if (typeof input.simple_mode === "boolean") prefsPatch.simple_mode = input.simple_mode;
  if (typeof input.wrap_reminder === "boolean") prefsPatch.wrap_reminder = input.wrap_reminder;
  if (typeof input.feedback_dm_opt_out === "boolean") prefsPatch.feedback_dm_opt_out = input.feedback_dm_opt_out;
  if (input.processing_notes !== undefined) {
    const n = String(input.processing_notes).trim();
    if (n.length > PROCESSING_NOTES_MAX) return { ok: false, error: `Processing notes must be ${PROCESSING_NOTES_MAX} characters or fewer.` };
    prefsPatch.processing_notes = n;
  }
  if (Object.keys(prefsPatch).length > 0) {
    const { data: cur, error: curErr } = await db()
      .from("tech_directory")
      .select("prefs")
      .eq("tech_id", techId)
      .maybeSingle();
    if (curErr) return { ok: false, error: curErr.message };
    const existing = (cur?.prefs && typeof cur.prefs === "object" ? cur.prefs : {}) as Record<string, unknown>;
    patch.prefs = { ...existing, ...prefsPatch };
  }

  const { error } = await db().from("tech_directory").update(patch).eq("tech_id", techId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  revalidatePath("/me"); // simple_mode reshapes /me
  revalidatePath("/", "layout"); // hide_quick_recorder is read in the root layout
  return { ok: true };
}

// ── Avatar upload (spec §1 Display) ─────────────────────────────────────────
// Upload-first (browser → Storage direct, the 4.5MB Vercel body law): this
// mints the signed slot in the public `avatars` bucket; the client PUTs, then
// saves the public URL through updateMySettings' whitelist (which re-checks
// the URL prefix). Path is tech-scoped + timestamped (cache-bust on change).
export async function createAvatarUpload(input: { filename?: string }): Promise<
  | { ok: true; path: string; token: string; publicUrl: string }
  | { ok: false; error: string }
> {
  const self = await requireSelf();
  if (!self.ok) return { ok: false, error: self.error };
  const techId = self.me.tech!.tech_id;
  const ext = (input.filename?.split(".").pop()?.toLowerCase() || "jpg").replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${techId}/${Date.now()}.${ext}`;
  const supa = db();
  const { data: signed, error } = await supa.storage.from("avatars").createSignedUploadUrl(path);
  if (error || !signed?.token) return { ok: false, error: `Could not start upload: ${error?.message ?? "no token"}` };
  const { data: pub } = supa.storage.from("avatars").getPublicUrl(signed.path ?? path);
  return { ok: true, path: signed.path ?? path, token: signed.token, publicUrl: pub.publicUrl };
}

// ── Owner-only global flags ─────────────────────────────────────────────────

// Customer-SMS / all-outbound master switch (mirrors board-actions setSmsEnabled;
// kept here so the Settings owner section has a single import surface).
export async function setSmsMaster(enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };
  const { error } = await db()
    .from("app_flags")
    .upsert({ key: "sms_notifications", enabled, updated_by: owner.email, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  revalidatePath("/inbox");
  return { ok: true };
}

// Phone-OTP login enable. Read pre-auth by the login page (getPhoneLoginEnabled,
// no gate — it's needed before sign-in). Flip once A2P 10DLC is approved.
export async function setPhoneLoginEnabled(enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };
  const { error } = await db()
    .from("app_flags")
    .upsert({ key: "phone_login_enabled", enabled, updated_by: owner.email, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

// Public (pre-auth) read used by the login page. DB flag OR the env fallback.
export async function getPhoneLoginEnabled(): Promise<boolean> {
  const { data } = await db().from("app_flags").select("enabled").eq("key", "phone_login_enabled").maybeSingle();
  if (data) return !!data.enabled;
  return process.env.NEXT_PUBLIC_ENABLE_PHONE_LOGIN === "true";
}
