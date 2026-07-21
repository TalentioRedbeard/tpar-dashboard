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
import { requireWriter, requireResolver, getCurrentTech } from "./current-tech";
import { techWorkedJob } from "./tech-scope";

const MAX_NOTE_LEN = 10_000;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

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

// Post a note INTO Housecall Pro (Danny 2026-07-21). HCP job notes are append-only
// entries, so this ADDS one via the hcp-add-job-note edge fn; it mirrors back as
// hcp_jobs_raw.hcp_notes on the next webhook/sync. Distinct from addJobNote (which
// records a TPAR-local job_notes row). Any operator (admin|tech|manager) can post —
// job notes are normal documentation.
export async function postJobNoteToHcp(input: { hcp_job_id: string; content: string }): Promise<AddNoteResult> {
  const jobId = (input.hcp_job_id ?? "").trim();
  const content = (input.content ?? "").trim();
  if (!jobId) return { ok: false, error: "missing hcp_job_id" };
  if (!content) return { ok: false, error: "note content required" };
  if (content.length > MAX_NOTE_LEN) return { ok: false, error: `note too long (>${MAX_NOTE_LEN} chars)` };

  const me = await getCurrentTech().catch(() => null);
  if (!me) return { ok: false, error: "Not signed in." };
  if (!(me.canWrite || me.isManager)) return { ok: false, error: "No write access." };
  // Per-job scope: admin|manager may note ANY job; a tech only jobs they worked
  // (jobs_master.assigned_employees, the canonical rule). Server actions are
  // directly invokable HTTP endpoints, so THIS — not the UI — is the boundary.
  if (!me.isAdmin && !me.isManager) {
    const worked = await techWorkedJob(me.tech?.hcp_employee_id, jobId);
    if (!worked) return { ok: false, error: "You can only add notes to jobs you've worked." };
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return { ok: false, error: "Server isn't configured to write to HCP." };
  const actor = me.tech?.tech_short_name ?? me.email ?? "app";

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/hcp-add-job-note`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ hcp_job_id: jobId, content, actor }),
    });
  } catch (e) {
    return { ok: false, error: `Couldn't reach HCP: ${e instanceof Error ? e.message : String(e)}` };
  }
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !j?.ok) return { ok: false, error: j?.error ?? `HCP note failed (${res.status}).` };

  revalidatePath(`/job/${jobId}`);
  return { ok: true };
}

// Phase 3 Tier 2 — reversible state change.
// ackComm: mark a communication_event as handled. Sets acked_at + acked_by.
// unackComm: clear the ack (re-flag as needing attention).
//
// Operator distinction: any signed-in operator (admin, tech, or manager)
// can ack/un-ack — see requireResolver(). We DON'T scope to "only the
// original recipient": Madisson sometimes resolves something Danny would
// have, and that's correct (wired 2026-05-30).

export type AckCommResult =
  | { ok: true; acked: boolean }
  | { ok: false; error: string };

export async function ackComm(formData: FormData): Promise<AckCommResult> {
  const id = Number(formData.get("comm_id") ?? "0");
  const action = String(formData.get("action") ?? "ack");
  if (!id || Number.isNaN(id)) return { ok: false, error: "missing comm_id" };
  if (action !== "ack" && action !== "unack") return { ok: false, error: "action must be ack|unack" };

  // Managers (Madisson) resolve comms too — requireResolver, not requireWriter.
  const writer = await requireResolver();
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
