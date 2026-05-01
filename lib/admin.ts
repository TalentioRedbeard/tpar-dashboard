// Admin gate. Phase 3 Tier 3 (tech_directory metadata edits) is restricted
// to a small allowlist — distinct from the dashboard-wide tulsapar.com
// allowlist that the middleware enforces. Set DASHBOARD_ADMIN_EMAILS as a
// comma-separated env var; defaults to Danny only.

const DEFAULT_ADMINS = ["ddunlop@tulsapar.com"];

const ADMIN_EMAILS = (process.env.DASHBOARD_ADMIN_EMAILS ?? DEFAULT_ADMINS.join(","))
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

export function adminEmailList(): string[] {
  return [...ADMIN_EMAILS];
}
