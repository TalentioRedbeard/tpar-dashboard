// US phone → E.164 (+1XXXXXXXXXX). Idempotent; returns null if it isn't a
// 10-digit US number. tech_directory.phone is stored strict +1XXXXXXXXXX, and
// Supabase puts E.164 in auth.users.phone — normalize defensively on both sides
// (directory numbers are hand-entered).
export function toE164US(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ten = String(raw).replace(/\D/g, "");
  if (ten.length === 11 && ten.startsWith("1")) ten = ten.slice(1);
  if (ten.length !== 10) return null;
  return `+1${ten}`;
}
