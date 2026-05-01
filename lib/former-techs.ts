// Helper for fetching the set of former-tech HCP full names. Used by
// pages that render tech names so they can mark former employees with
// a "(former)" tag — keeping historical attribution intact while
// distinguishing them from currently-active staff.

import { db } from "./supabase";

let cached: { set: Set<string>; ts: number } | null = null;
const TTL_MS = 60_000; // refresh once per minute

export async function getFormerTechNames(): Promise<Set<string>> {
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return cached.set;
  }
  const supa = db();
  const { data } = await supa
    .from("former_techs")
    .select("hcp_full_name");
  const set = new Set<string>(
    (data ?? [])
      .map((r) => r.hcp_full_name as string | null)
      .filter((n): n is string => Boolean(n))
  );
  cached = { set, ts: Date.now() };
  return set;
}

/** Render-side helper: returns "Name (former)" or "Name" depending on the set. */
export function annotateTechName(name: string | null | undefined, formerSet: Set<string>): {
  name: string;
  isFormer: boolean;
} {
  const n = name ?? "—";
  return { name: n, isFormer: formerSet.has(n) };
}
