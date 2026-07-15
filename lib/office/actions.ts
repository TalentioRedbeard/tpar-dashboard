"use server";

// TPAR Office server actions — every one self-authorizes with requireOwner()
// (the office is owner-only in v1; view-as never passes an owner gate). All
// cfo.* access goes through the public.cfo_* SECURITY DEFINER doorways — the
// schema is deliberately NOT PostgREST-exposed (access-model lock, plan
// 2026-07-15). Documents upload bucket-direct via signed upload URLs (the
// 1MB server-action body limit + 4.5MB Vercel cap make upload-first the law).

import { db } from "@/lib/supabase";
import { requireOwner } from "@/lib/current-tech";

export type BoardRow = {
  obligation_id: string;
  name: string;
  category: string;
  counterparty: string | null;
  cadence: string;
  next_due_on: string | null;
  amount_cents: number | null;
  auto_pay: boolean;
  status: string;
  evidence_hint: string | null;
  source_notes: string | null;
  open_event_id: number | null;
  open_event_due_on: string | null;
};

export async function getBoard(): Promise<{ ok: true; rows: BoardRow[] } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { data, error } = await db().rpc("cfo_board");
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as BoardRow[] };
}

export async function completeEvent(input: {
  eventId: number;
  note?: string;
  amountDollars?: string;
}): Promise<{ ok: boolean; error?: string; nextDueOn?: string | null }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  // Dollars in the UI → cents at the boundary (house money law).
  let cents: number | null = null;
  if (input.amountDollars && input.amountDollars.trim()) {
    const n = Number(input.amountDollars.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Amount doesn't parse." };
    cents = Math.round(n * 100);
  }
  const { data, error } = await db().rpc("cfo_complete_event", {
    p_event_id: input.eventId,
    p_completed_by: gate.email,
    p_note: input.note?.trim() || null,
    p_amount_cents: cents,
  });
  if (error) return { ok: false, error: error.message };
  const r = data as { ok: boolean; error?: string; next_due_on?: string | null };
  return r.ok ? { ok: true, nextDueOn: r.next_due_on ?? null } : { ok: false, error: r.error };
}

export async function setDueDate(input: {
  obligationId: string;
  dueOn: string; // yyyy-mm-dd
}): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) return { ok: false, error: "Pick a date." };
  const { data, error } = await db().rpc("cfo_set_due_date", {
    p_obligation_id: input.obligationId,
    p_due_on: input.dueOn,
  });
  if (error) return { ok: false, error: error.message };
  const r = data as { ok: boolean; error?: string };
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

const DOC_TYPES = new Set([
  "cp575", "sos_filing", "insurance_policy", "coi", "license", "w9",
  "tax_return", "lease", "contract", "bank", "statement", "other",
]);

export async function startVaultUpload(input: {
  filename: string;
  docType: string;
}): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!DOC_TYPES.has(input.docType)) return { ok: false, error: "Unknown document type." };
  const safe = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
  const path = `${input.docType}/${Date.now()}-${safe}`;
  const { data: signed, error } = await db().storage.from("cfo-vault").createSignedUploadUrl(path);
  if (error || !signed?.token) return { ok: false, error: `Could not start upload: ${error?.message ?? "no token"}` };
  return { ok: true, path: signed.path ?? path, token: signed.token };
}

export async function recordDocument(input: {
  title: string;
  docType: string;
  storagePath: string;
  effectiveDate?: string;
  expiresOn?: string;
  eventId?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.title.trim()) return { ok: false, error: "Give it a title." };
  if (!DOC_TYPES.has(input.docType)) return { ok: false, error: "Unknown document type." };
  const { data, error } = await db().rpc("cfo_record_document", {
    p_title: input.title.trim(),
    p_doc_type: input.docType,
    p_storage_path: input.storagePath,
    p_uploaded_by: gate.email,
    p_effective_date: input.effectiveDate || null,
    p_expires_on: input.expiresOn || null,
    p_event_id: input.eventId ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const r = data as { ok: boolean; error?: string };
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export type VaultDoc = {
  id: string;
  title: string;
  doc_type: string;
  storage_path: string | null;
  effective_date: string | null;
  expires_on: string | null;
  status: string;
  created_at: string;
};

export async function listDocuments(): Promise<{ ok: true; docs: VaultDoc[] } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { data, error } = await db().rpc("cfo_list_documents");
  if (error) return { ok: false, error: error.message };
  return { ok: true, docs: (data ?? []) as VaultDoc[] };
}

/** Short-lived signed view URL for one vault document (10 minutes). */
export async function signedDocUrl(storagePath: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { data, error } = await db().storage.from("cfo-vault").createSignedUrl(storagePath, 600);
  if (error || !data?.signedUrl) return { ok: false, error: error?.message ?? "no url" };
  return { ok: true, url: data.signedUrl };
}

export async function getEntityOverview(): Promise<{ ok: true; overview: Record<string, unknown> } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { data, error } = await db().rpc("cfo_entity_overview");
  if (error) return { ok: false, error: error.message };
  return { ok: true, overview: (data ?? {}) as Record<string, unknown> };
}

export async function updateContactStatus(input: {
  contactId: string;
  status: "not_started" | "in_progress" | "done" | "n_a";
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { data, error } = await db().rpc("cfo_update_contact_status", {
    p_contact_id: input.contactId,
    p_status: input.status,
    p_note: input.note?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  const r = data as { ok: boolean; error?: string };
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
