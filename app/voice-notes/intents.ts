// Shared voice-note intent options. This is a PLAIN module (NOT "use client")
// on purpose: both the /voice-notes/new Server Component and the
// VoiceNoteRecorder Client Component import these arrays. Importing a value
// from a "use client" module into a Server Component yields a client-reference
// proxy (not the array), which crashed the page with
// "PRIMARY_INTENTS.map is not a function". Keeping the data here fixes that.

export type IntentOption = { value: string; label: string };

// The first four are the primary "what kind of voice note is this?" categories
// a tech is most likely recording in the field.
export const PRIMARY_INTENTS: IntentOption[] = [
  { value: "diagnostic",     label: "Diagnostic (what's wrong, what you found)" },
  { value: "change-order",   label: "Change order conversation (scope/price shift)" },
  { value: "billing",        label: "Billing (payment, invoice, dispute)" },
  { value: "other",          label: "Other" },
];

export const TECH_INTENTS: IntentOption[] = [
  ...PRIMARY_INTENTS,
  { value: "estimate-context", label: "Estimate context (use as Based-on… reference)" },
  { value: "job-note",         label: "Job note (general info, decisions on site)" },
  { value: "process-doc",      label: "Process documentation" },
];

export const LEADERSHIP_INTENTS: IntentOption[] = [
  ...PRIMARY_INTENTS,
  { value: "estimate-context",   label: "Estimate context (use as Based-on… reference)" },
  { value: "scheduling-issue",   label: "Scheduling issue / dispatch concern" },
  { value: "process-concern",    label: "Process concern (workflow, system, organization)" },
  { value: "employee-concern",   label: "Employee concern (private — leadership only)" },
  { value: "system-issue",       label: "System / website / tool issue" },
  { value: "leadership-note",    label: "Leadership note (general — discuss later)" },
  { value: "job-note",           label: "Job note (general info, decisions)" },
  { value: "process-doc",        label: "Process documentation" },
];
