// Phase 3 Tier 2.5 server actions: maintenance_agreements writes.
//
// Auth: any signed-in tulsapar.com user (the middleware allowlist).
// Audit: every create/update/cancel logs to maintenance_logs source='agreement-edit'.
// Scope: v0 only — create, update fields, cancel. Auto-scheduling is v1.

"use server";

import { revalidatePath } from "next/cache";
import { db } from "./supabase";
import { requireWriter } from "./current-tech";

export type AgreementResult =
  | { ok: true; id?: number }
  | { ok: false; error: string };

const STATUSES = new Set(["active", "paused", "canceled", "completed"]);
const ORIGINS = new Set(["recurring_jobs", "repeat_jobs", "comm_patterns", "manual"]);
const MAX_SCOPE_LEN = 4000;

function parseCadence(raw: FormDataEntryValue | null): number | null | "invalid" {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 7 || n > 730) return "invalid";
  return n;
}

function parsePriceCents(raw: FormDataEntryValue | null): number | null | "invalid" {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  // Accept dollars (e.g. "165" or "165.00") OR cents prefixed with "c" (rare).
  const dollars = Number(s);
  if (!Number.isFinite(dollars) || dollars < 0) return "invalid";
  return Math.round(dollars * 100);
}

export async function createAgreement(formData: FormData): Promise<AgreementResult> {
  const customerId = String(formData.get("hcp_customer_id") ?? "").trim();
  const scopeText  = String(formData.get("scope_text") ?? "").trim();
  const startsOn   = String(formData.get("starts_on") ?? "").trim();
  const endsOn     = String(formData.get("ends_on") ?? "").trim();
  const origin     = String(formData.get("origin_pattern") ?? "manual").trim();

  if (!customerId) return { ok: false, error: "missing hcp_customer_id" };
  if (!scopeText)  return { ok: false, error: "scope is required" };
  if (scopeText.length > MAX_SCOPE_LEN) return { ok: false, error: `scope too long (>${MAX_SCOPE_LEN} chars)` };
  if (!ORIGINS.has(origin)) return { ok: false, error: "invalid origin_pattern" };

  const cadence = parseCadence(formData.get("cadence_days"));
  if (cadence === "invalid") return { ok: false, error: "cadence_days must be 7–730" };
  const priceCents = parsePriceCents(formData.get("base_price"));
  if (priceCents === "invalid") return { ok: false, error: "base_price must be a non-negative number" };

  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };

  const supa = db();
  const insertRow: Record<string, unknown> = {
    hcp_customer_id: customerId,
    scope_text: scopeText,
    cadence_days: cadence,
    base_price_cents: priceCents,
    status: "active",
    origin_pattern: origin,
    author_email: writer.email,
  };
  if (startsOn) insertRow.starts_on = startsOn;
  if (endsOn)   insertRow.ends_on   = endsOn;

  const { data, error } = await supa
    .from("maintenance_agreements")
    .insert(insertRow)
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await supa.from("maintenance_logs").insert({
    source: "agreement-edit",
    level: "info",
    message: `agreement created`,
    context: {
      action: "create",
      agreement_id: data?.id,
      hcp_customer_id: customerId,
      author_email: writer.email,
      scope_text: scopeText.slice(0, 200),
      cadence_days: cadence,
      base_price_cents: priceCents,
      origin_pattern: origin,
    },
  });

  revalidatePath(`/customer/${customerId}`);
  revalidatePath("/reports/agreements");
  return { ok: true, id: data?.id };
}

export async function updateAgreementStatus(formData: FormData): Promise<AgreementResult> {
  const id     = Number(formData.get("agreement_id") ?? "0");
  const status = String(formData.get("status") ?? "").trim();
  if (!id || Number.isNaN(id)) return { ok: false, error: "missing agreement_id" };
  if (!STATUSES.has(status))   return { ok: false, error: "invalid status" };

  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };

  const supa = db();
  const { data: prior, error: priorErr } = await supa
    .from("maintenance_agreements")
    .select("id, hcp_customer_id, status")
    .eq("id", id)
    .maybeSingle();
  if (priorErr) return { ok: false, error: `lookup failed: ${priorErr.message}` };
  if (!prior)   return { ok: false, error: `agreement ${id} not found` };

  const { error } = await supa
    .from("maintenance_agreements")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await supa.from("maintenance_logs").insert({
    source: "agreement-edit",
    level: "info",
    message: `agreement status: ${prior.status} → ${status}`,
    context: {
      action: "status_change",
      agreement_id: id,
      hcp_customer_id: prior.hcp_customer_id,
      author_email: writer.email,
      before: prior.status,
      after: status,
    },
  });

  revalidatePath(`/customer/${prior.hcp_customer_id}`);
  revalidatePath("/reports/agreements");
  return { ok: true, id };
}
