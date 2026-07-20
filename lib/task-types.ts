// Task System v1 — shared types + pure helpers (2026-06-24).
//
// These live OUTSIDE lib/tasks.ts because that file is "use server" — every export
// from a "use server" module must be an async server action, so plain constants /
// types / type-guards can't live there and be imported by client components.

// Blocker taxonomy (Danny Q4 2026-06-22): "part/info/skill-and/or-help/access/customer/other".
// A blocker requirement lives in tasks.requirements[] as {kind:'blocker', types:[...], note},
// alongside the existing free-text requirement/skill rows.
export type BlockerType = "part" | "info" | "help" | "access" | "customer" | "other";

export const BLOCKER_TYPES: { value: BlockerType; label: string }[] = [
  { value: "part", label: "Part" },
  { value: "info", label: "Info" },
  { value: "help", label: "Skill &/or Help" },
  { value: "access", label: "Access" },
  { value: "customer", label: "Customer" },
  { value: "other", label: "Other" },
];

export type TaskRequirement =
  | { text: string; kind: "requirement" | "skill"; added_by?: string; added_at?: string }
  | { kind: "blocker"; types: BlockerType[]; note: string | null; added_by?: string; added_at?: string };

export type TaskStatus = "open" | "in_progress" | "blocked" | "done" | "canceled";

export type Task = {
  id: string;
  title: string;
  detail: string | null;
  assigned_to: string | null;
  status: TaskStatus;
  requirements: TaskRequirement[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  tech_response: "accepted" | "declined" | null;
  tech_response_note: string | null;
  tech_response_at: string | null;
  // Phase 3 follow-up engine linkage (migration 20260620000000).
  ref_kind: string | null;
  ref_id: string | null;
  due_at: string | null;
  // Task System v1 (shared schema contract 2026-06-24). The backend agent adds these
  // columns concurrently; select('*') returns them once applied (null-safe before then).
  parent_task_id: string | null;
  assigned_role: string | null;
  source: string | null;
  template_key: string | null;
  blocked_reason: string | null;
};

export type TaskResult = { ok: true } | { ok: false; error: string };

// Type-guard for the blocker requirement variant.
export function isBlockerReq(r: TaskRequirement): r is Extract<TaskRequirement, { kind: "blocker" }> {
  return r.kind === "blocker";
}

// Downtime bank template (tasks_master). Manager-editable (create/edit/remove/reorder)
// as of 2026-07-20 — the fuller field set below is what the bank editor exposes so a
// task carries real instructions (what to do), an expected outcome (what "done" is),
// and a trackable metric (what to report) — nobody should have to guess how to do one.
export type TaskTemplate = {
  id: number;
  task_key: string;
  task_name: string;
  category: string | null;
  instructions: string | null;
  expected_outcome: string | null;
  trackable_metric: string | null;
  estimated_minutes: number | null;
  eligible_techs: string[] | null;
  requires_geo: boolean;
  geo_target: string | null;
  min_gap_minutes: number | null;
  sort_order: number;
  active: boolean;
};

// tasks_master.category CHECK constraint — keep in lockstep with the DB.
export const TASK_CATEGORIES = ["operational", "promotional", "business_dev"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

// Shape the bank editor submits for create/update (task_key is derived server-side).
export type TaskTemplateInput = {
  task_name: string;
  category: TaskCategory;
  instructions: string;
  expected_outcome?: string | null;
  trackable_metric?: string | null;
  estimated_minutes?: number | null;
  eligible_techs?: string[] | null;
  requires_geo?: boolean;
  geo_target?: string | null;
};
