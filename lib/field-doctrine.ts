// Field Doctrine data access — public.field_doctrine holds the operating
// doctrine distilled from Danny's field walkthroughs (2026-07): the money
// ladder (how charging works, steps 0-5), the 10 carry-yourself principles,
// and the 4-rung "when you're stuck" escalation ladder.
//
// SERVER-ONLY (imports lib/supabase service-role client) — never import from
// a "use client" module. Renderers: components/FieldGuide.tsx (/how-to) and
// components/TodaysOneThing.tsx (/me).

import { db } from "./supabase";

export type DoctrineSection = "principle" | "money_ladder" | "stuck_ladder";

export type DoctrineRow = {
  section: DoctrineSection;
  ord: number;
  title: string;
  rule: string;
  detail: string | null;
  icon: string | null;
  /** true = the dollar amounts referenced are still being finalized → show the amber "$ being finalized" chip. */
  check_pending: boolean;
};

export async function getFieldDoctrine(): Promise<DoctrineRow[]> {
  const { data, error } = await db()
    .from("field_doctrine")
    .select("section, ord, title, rule, detail, icon, check_pending")
    .eq("active", true)
    .eq("approved", true) // tech-visibility gate: new rows hidden until Danny approves
    .order("section")
    .order("ord");
  if (error) {
    // Doctrine is a guide surface, never load-bearing — render nothing over 500ing.
    // eslint-disable-next-line no-console
    console.error("[field-doctrine] fetch failed:", error.message);
    return [];
  }
  return (data ?? []) as DoctrineRow[];
}

/**
 * The "Today's one thing" pick for /me — ONE principle, rotating daily.
 * Deterministic: day-of-year in America/Chicago % principle count, so every
 * tech sees the same principle all day and it advances at midnight Chicago.
 */
export async function getDailyPrinciple(): Promise<DoctrineRow | null> {
  const principles = (await getFieldDoctrine()).filter((r) => r.section === "principle");
  if (principles.length === 0) return null;
  // Chicago calendar date (DST-proof), then day-of-year via UTC math.
  const chi = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // YYYY-MM-DD
  const [y, m, d] = chi.split("-").map(Number);
  const dayOfYear = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
  return principles[dayOfYear % principles.length];
}
