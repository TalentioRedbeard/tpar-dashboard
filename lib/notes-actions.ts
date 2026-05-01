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
import { requireWriter } from "./current-tech";

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

  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };

  const supa = db();
  const { error } = await supa.from("customer_notes").insert({
    hcp_customer_id: customerId,
    author_email: writer.email,
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

  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };

  const supa = db();
  const { error } = await supa.from("job_notes").insert({
    hcp_job_id: jobId,
    author_email: writer.email,
    body,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/job/${jobId}`);
  return { ok: true };
}

// Phase 3 Tier 2 — reversible state change.
// ackComm: mark a communication_event as handled. Sets acked_at + acked_by.
// unackComm: clear the ack (re-flag as needing attention).
//
// Operator distinction: any tulsapar.com signed-in user can ack/un-ack.
// We DON'T scope to "only the original recipient" — Madisson sometimes
// resolves something Danny would have, and that's correct.

export type AckCommResult =
  | { ok: true; acked: boolean }
  | { ok: false; error: string };

export async function ackComm(formData: FormData): Promise<AckCommResult> {
  const id = Number(formData.get("comm_id") ?? "0");
  const action = String(formData.get("action") ?? "ack");
  if (!id || Number.isNaN(id)) return { ok: false, error: "missing comm_id" };
  if (action !== "ack" && action !== "unack") return { ok: false, error: "action must be ack|unack" };

  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };

  const supa = db();
  const update = action === "ack"
    ? { acked_at: new Date().toISOString(), acked_by: writer.email }
    : { acked_at: null, acked_by: null };

  const { error } = await supa
    .from("communication_events")
    .update(update)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  // Refresh the surfaces that filter on acked_at
  revalidatePath("/");
  revalidatePath("/comms");

  return { ok: true, acked: action === "ack" };
}
