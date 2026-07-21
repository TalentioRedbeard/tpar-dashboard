// Shared type for the "My Captures" tray (Danny 2026-07-21). Lives outside
// lib/recordings.ts because that file is "use server" — every export there must
// be an async server action, so plain types can't live there.

export type MyCapture = {
  id: string;
  created_at: string;
  duration_ms: number | null;
  label: string | null;
  transcript: string | null;
  transcript_status: string | null;
  target_kind: string | null;
  target_ref: string | null;
  /** Resolved cus_ id for customer-targeted captures — powers the "Build estimate" deep-link. */
  customer_id: string | null;
  /** Human label: "Customer · Jane Doe", "Job #1234", "Unfiled", … */
  filedLabel: string;
};
