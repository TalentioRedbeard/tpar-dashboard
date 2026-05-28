// Admin gate.
//
// As of 2026-05-01 the canonical source of truth is tech_directory.dashboard_role
// (admin / manager / tech). The legacy DASHBOARD_ADMIN_EMAILS env var is kept
// as a bootstrap fallback so we don't lock ourselves out if the DB query fails
// or a new admin hasn't been migrated into tech_directory yet.
//
// For role-aware checks that need the DB row (manager detection, write gating),
// use getCurrentTech() / requireWriter() in lib/current-tech.ts instead.

const DEFAULT_ADMINS = ["ddunlop@tulsapar.com"];

const ADMIN_EMAILS = (process.env.DASHBOARD_ADMIN_EMAILS ?? DEFAULT_ADMINS.join(","))
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Synchronous email-only admin check. Used in middleware / nav rendering
 * where we can't await a DB query. Returns true if the email is in the
 * env allowlist. The DB check (tech_directory.dashboard_role) lives in
 * getCurrentTech() and supersedes this in places that have a session.
 */
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

export function adminEmailList(): string[] {
  return [...ADMIN_EMAILS];
}

// ── Owner gate ───────────────────────────────────────────────────────────
// Narrower than admin: the owner is just Danny. "admin" can include other
// accounts (env allowlist or dashboard_role='admin', e.g. office managers);
// owner-only capabilities (editing the global "?" help content) must NOT be
// available to them. Env-overridable so the owner can change without a deploy,
// but defaults to the single owner email.

const DEFAULT_OWNERS = ["ddunlop@tulsapar.com"];

const OWNER_EMAILS = (process.env.DASHBOARD_OWNER_EMAILS ?? DEFAULT_OWNERS.join(","))
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Owner-only check. True only for the owner account(s) — distinct from and
 * stricter than isAdmin(). Use for capabilities that no other account, admin
 * or otherwise, should have.
 */
export function isOwner(email: string | null | undefined): boolean {
  if (!email) return false;
  return OWNER_EMAILS.includes(email.toLowerCase());
}
