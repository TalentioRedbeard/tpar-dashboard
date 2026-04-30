// Server actions for Phase 3 writes: appending notes to customers + jobs.
//
// Auth model:
//   - Reader: must be signed-in (middleware enforces tulsapar.com allowlist).
//   - Author: pulled from session cookie via getSessionUser().
//   - Executor: service_role db() client (RLS is deny-all per the
//     04-28 lockdown; only service_role can write).
//
// Per project_phase3_writes_scope_2026-04-30: append-only is the chosen
// shape for v0. No edit, no soft-delete, no per-customer permissions.
// If/when we want those, they become explicit additional Tier-2 work.

"use server";

import { revalidatePath } from "next/cache";
import { db } from "./supabase";
import { getSessionUser } from "./supabase-server";

const MAX_NOTE_LEN = 10_000;

export type AddNoteResult =
  | { ok: true }
  | { ok: false; error: string };

export async function addCustomerNote(formData: FormData): Promise<AddNoteResult> {
  const customerId = String(formData.get("hcp_customer_id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!customerId) return { ok: false, error: "missing hcp_customer_id" };
  if (!body) return { ok: false, error: "note body required" };
  if (body.length > MAX_NOTE_LEN) return { ok: false, error: `note too long (>${MAX_NOTE_LEN} chars)` };

  const user = await getSessionUser();
  if (!user?.email) return { ok: false, error: "not signed in" };

  const supa = db();
  const { error } = await supa.from("customer_notes").insert({
    hcp_customer_id: customerId,
    author_email: user.email,
    body,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/customer/${customerId}`);
  return { ok: true };
}

export async function addJobNote(formData: FormData): Promise<AddNoteResult> {
  const jobId = String(formData.get("hcp_job_id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!jobId) return { ok: false, error: "missing hcp_job_id" };
  if (!body) return { ok: false, error: "note body required" };
  if (body.length > MAX_NOTE_LEN) return { ok: false, error: `note too long (>${MAX_NOTE_LEN} chars)` };

  const user = await getSessionUser();
  if (!user?.email) return { ok: false, error: "not signed in" };

  const supa = db();
  const { error } = await supa.from("job_notes").insert({
    hcp_job_id: jobId,
    author_email: user.email,
    body,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/job/${jobId}`);
  return { ok: true };
}
