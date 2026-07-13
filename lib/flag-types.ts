// Flag taxonomy (build plan 2026-07-13 section 2.3 + decision #5).
// Client-safe constants only — server reads live in lib/flags.ts, writes in
// lib/flag-actions.ts. Danny's rule: EVERYTHING is flaggable — or at least
// questionable — so "question" is a first-class type, and the what-and-why
// note is REQUIRED (a bare flag with no why is half a flag).
export const FLAG_TYPES = [
  { key: "question", label: "Question", emoji: "❓" },
  { key: "wrong_data", label: "Wrong data", emoji: "❌" },
  { key: "duplicate", label: "Duplicate", emoji: "👯" },
  { key: "missing_info", label: "Missing info", emoji: "🧩" },
  { key: "money_mismatch", label: "Money mismatch", emoji: "💸" },
  { key: "timecard_conflict", label: "Timecard conflict", emoji: "🕐" },
  { key: "needs_followup", label: "Needs follow-up", emoji: "📞" },
  { key: "other", label: "Other", emoji: "🚩" },
] as const;

export type FlagTypeKey = (typeof FLAG_TYPES)[number]["key"];

export type FlagEntityType = "job" | "estimate" | "customer" | "timecard_day";

export type DataFlag = {
  id: number;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  flag_type: string;
  severity: string;
  status: string;
  note: string;
  resolution_note: string | null;
  source: string;
  created_by: string;
  assigned_to: string | null;
  task_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
};

export function flagTypeMeta(key: string) {
  return FLAG_TYPES.find((t) => t.key === key) ?? { key, label: key, emoji: "🚩" };
}

/** Where a flag's entity lives in the app (null = no page). */
export function flagEntityHref(f: Pick<DataFlag, "entity_type" | "entity_id">): string | null {
  switch (f.entity_type) {
    case "job": return `/job/${f.entity_id}`;
    case "estimate": return `/estimate/${f.entity_id}`;
    case "customer": return `/customer/${f.entity_id}`;
    default: return null;
  }
}
