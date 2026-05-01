// Helper for fetching the set of former-tech names. Used by pages that
// render tech names so they can mark former employees with a "(former)"
// tag — keeping historical attribution intact while distinguishing them
// from currently-active staff.
//
// We expose two sets because different surfaces store different name
// shapes:
//   - hcp_full_name (e.g. "Travis Kilmer") — used in job_360,
//     appointments_master.tech_primary_name, tech_all_names
//   - tech_short_name (e.g. "Travis") — used in communication_events.tech_short_name

import { db } from "./supabase";

let cached: { full: Set<string>; short: Set<string>; ts: number } | null = null;
const TTL_MS = 60_000; // refresh once per minute

async function loadCache(): Promise<{ full: Set<string>; short: Set<string> }> {
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return { full: cached.full, short: cached.short };
  }
  const supa = db();
  const { data } = await supa
    .from("former_techs")
    .select("hcp_full_name, tech_short_name");
  const rows = (data ?? []) as Array<{ hcp_full_name: string | null; tech_short_name: string | null }>;
  const full = new Set<string>(
    rows.map((r) => r.hcp_full_name).filter((n): n is string => Boolean(n))
  );
  const short = new Set<string>(
    rows.map((r) => r.tech_short_name).filter((n): n is string => Boolean(n))
  );
  cached = { full, short, ts: Date.now() };
  return { full, short };
}

/** Set of former-tech HCP full names (e.g. "Travis Kilmer"). */
export async function getFormerTechNames(): Promise<Set<string>> {
  return (await loadCache()).full;
}

/** Set of former-tech short names (e.g. "Travis"). */
export async function getFormerTechShortNames(): Promise<Set<string>> {
  return (await loadCache()).short;
}

/** Render-side helper: returns "Name (former)" or "Name" depending on the set. */
export function annotateTechName(name: string | null | undefined, formerSet: Set<string>): {
  name: string;
  isFormer: boolean;
} {
  const n = name ?? "—";
  return { name: n, isFormer: formerSet.has(n) };
}
