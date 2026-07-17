// Purchaser helpers — Phase 0 of the gallery-framework spec
// (tpar-supabase docs/SPEC_2026-07-16_GALLERY_FRAMEWORK.md, RWD 2026-07-16).
//
// A receipt's "purchaser" is who it's attributed to: receipts_master.tech_name
// (free-text short name, historically auto-stamped from the submitter's session
// on every ingest path). Valid values = tech_directory (is_active) ∪ former_techs
// (offboarded people still carry historical receipts). Plain server module —
// NOT "use server" — so both action modules and server components can share it.

import { db } from "@/lib/supabase";

export type PurchaserOption = {
  shortName: string;        // what gets written into receipts_master.tech_name
  fullName: string | null;  // hcp_full_name, display aid
  former: boolean;
};

// Throws on a roster-query failure so callers can distinguish "not a known
// tech" from "couldn't check right now" (review 2026-07-16: swallowing the
// error made transient failures read as roster problems).
export async function listPurchaserOptions(): Promise<PurchaserOption[]> {
  const supa = db();
  const [act, fmr] = await Promise.all([
    supa.from("tech_directory").select("tech_short_name, hcp_full_name").eq("is_active", true).order("tech_short_name"),
    supa.from("former_techs").select("tech_short_name").order("tech_short_name"),
  ]);
  if (act.error) throw new Error(`tech_directory query failed: ${act.error.message}`);
  if (fmr.error) throw new Error(`former_techs query failed: ${fmr.error.message}`);
  const active = act.data;
  const former = fmr.data;
  const seen = new Set<string>();
  const out: PurchaserOption[] = [];
  for (const t of (active ?? []) as Array<{ tech_short_name: string | null; hcp_full_name: string | null }>) {
    const s = t.tech_short_name?.trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push({ shortName: s, fullName: t.hcp_full_name ?? null, former: false });
  }
  for (const t of (former ?? []) as Array<{ tech_short_name: string | null }>) {
    const s = t.tech_short_name?.trim();
    if (!s || seen.has(s.toLowerCase())) continue; // active roster wins on name collision
    seen.add(s.toLowerCase());
    out.push({ shortName: s, fullName: null, former: true });
  }
  return out;
}

// Exact case-insensitive match against the allowed set, compared in JS — NO
// LIKE/ILIKE pattern language at all. (Review 2026-07-16: PostgREST rewrites
// `*` to `%` in ilike values, so any pattern-escape approach leaves a wildcard
// hole — "Chr*" would silently resolve to an arbitrary Chris, the exact
// 2nd-Chris collision this module exists to guard.) Deterministic: the dedupe
// in listPurchaserOptions makes the active roster win a name collision.
// Returns the CANONICAL short name (directory casing) or null; throws on a
// roster-query failure (callers translate to "try again", not "unknown tech").
export async function validatePurchaser(candidate: string): Promise<string | null> {
  const c = candidate.trim().toLowerCase();
  if (!c) return null;
  const options = await listPurchaserOptions();
  return options.find((o) => o.shortName.toLowerCase() === c)?.shortName ?? null;
}
