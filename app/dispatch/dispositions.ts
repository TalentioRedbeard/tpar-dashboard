// Shared disposition vocabulary for /dispatch items.
//
// Plain module (NOT "use server") so types + helpers can be imported by both the
// server action (actions.ts) and client components (DispatchAck.tsx) + the page.
//
// A disposition is either ACTIVE (stays in the live view — still needs attention)
// or RESOLVING (auto-collapses the item out of the active view; retrievable via
// "Show resolved"). Per Danny 2026-05-30: clearing/pausing an item with a reason
// should make it disappear from the working lists.

export type DispatchItemType = "appointment" | "stale_appointment" | "needs_scheduling" | "comm_event";

export type DispatchAckStatus =
  // active — stays visible
  | "needs_followup"
  | "needs_review"
  | "needs_advise"
  | "scheduled_active"
  // resolving — auto-collapses
  | "addressed"
  | "declined"
  | "awaiting_client"
  | "deferred"
  | "completed"
  | "test_internal"
  | "no_response_stale"
  | "paused";

export const ACTIVE_STATUSES: DispatchAckStatus[] = [
  "needs_followup", "needs_review", "needs_advise", "scheduled_active",
];

export const RESOLVING_STATUSES: DispatchAckStatus[] = [
  "addressed", "declined", "awaiting_client", "deferred", "completed", "test_internal", "no_response_stale", "paused",
];

export const ALL_STATUSES: DispatchAckStatus[] = [...ACTIVE_STATUSES, ...RESOLVING_STATUSES];

export const VALID_ITEM_TYPES: DispatchItemType[] = ["appointment", "stale_appointment", "needs_scheduling", "comm_event"];

export function isResolving(s: DispatchAckStatus | null | undefined): boolean {
  return !!s && (RESOLVING_STATUSES as readonly string[]).includes(s);
}

export const DISPOSITION_LABEL: Record<DispatchAckStatus, string> = {
  needs_followup:    "↻ follow-up",
  needs_review:      "👁 review",
  needs_advise:      "❓ advise",
  scheduled_active:  "📅 scheduled / active",
  addressed:         "✓ addressed",
  declined:          "✕ declined",
  awaiting_client:   "⏳ awaiting client",
  deferred:          "💤 deferred",
  completed:         "✓ completed",
  test_internal:     "🧪 test / internal",
  no_response_stale: "🚫 no response",
  paused:            "⏸ paused",
};

// Short human description shown under each option in the picker.
export const DISPOSITION_HINT: Record<DispatchAckStatus, string> = {
  needs_followup:    "needs a follow-up action",
  needs_review:      "watch / keep an eye on it",
  needs_advise:      "needs a decision or guidance",
  scheduled_active:  "work is booked or in progress",
  addressed:         "handled — nothing more to do",
  declined:          "customer is not moving forward",
  awaiting_client:   "contract changed; waiting on the client",
  deferred:          "client is watching / will decide later",
  completed:         "work is done",
  test_internal:     "test or internal record — not real work",
  no_response_stale: "no response; stale record",
  paused:            "on hold (see note)",
};

export function dispositionLabel(status: DispatchAckStatus | undefined): string {
  return status ? DISPOSITION_LABEL[status] : "+ status";
}

export function dispositionChip(status: DispatchAckStatus | undefined): string {
  switch (status) {
    case "needs_followup":    return "bg-amber-100 text-amber-800 border border-amber-200";
    case "needs_review":      return "bg-sky-100 text-sky-800 border border-sky-200";
    case "needs_advise":      return "bg-violet-100 text-violet-800 border border-violet-200";
    case "scheduled_active":  return "bg-blue-100 text-blue-800 border border-blue-200";
    case "addressed":
    case "completed":         return "bg-emerald-100 text-emerald-800 border border-emerald-200";
    case "declined":          return "bg-rose-100 text-rose-800 border border-rose-200";
    case "awaiting_client":   return "bg-orange-100 text-orange-800 border border-orange-200";
    case "deferred":          return "bg-indigo-100 text-indigo-800 border border-indigo-200";
    case "test_internal":     return "bg-neutral-200 text-neutral-700 border border-neutral-300";
    case "no_response_stale": return "bg-stone-100 text-stone-600 border border-stone-300";
    case "paused":            return "bg-zinc-100 text-zinc-700 border border-zinc-300";
    default:                  return "bg-neutral-50 text-neutral-500 border border-dashed border-neutral-300";
  }
}

export function ackBorder(status: DispatchAckStatus | undefined): string {
  if (!status) return "border-neutral-200";
  if (isResolving(status)) return "border-emerald-200";
  switch (status) {
    case "needs_followup":   return "border-amber-300";
    case "needs_review":     return "border-sky-300";
    case "needs_advise":     return "border-violet-300";
    case "scheduled_active": return "border-blue-300";
    default:                 return "border-neutral-200";
  }
}
