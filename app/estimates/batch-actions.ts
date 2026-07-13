"use server";

// Batch estimate sends (Danny 7/13: "I should be able to send these estimates
// in batches"). Management-gated — batch is a management surface; the
// per-estimate guardrails (override wins, live terminal-state refusal,
// claim-first dedupe, no-recipient skip) all live in the send-estimate edge
// fn, so every item in the batch gets the exact same protection as a single
// send. Test mode (to the caller's own inbox) sends [TEST]-subject emails as
// kind='test' rows the pipeline and follow-up engine never see.
//
// The client chunks selections to ≤10 ids per call and shows progress —
// keeps each server action fast and gives the sender per-row outcomes.

import { requireManagement } from "@/lib/current-tech";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const MAX_PER_CALL = 10;
const SPACING_MS = 700; // Resend rate courtesy

export type BatchItemResult = {
  id: string;
  ok: boolean;
  deduped?: boolean;
  error?: string;
};

export type BatchSendResult =
  | { ok: true; results: BatchItemResult[] }
  | { ok: false; error: string };

export async function batchSendEstimates(input: {
  ids: string[];
  test: boolean;
  toEmail?: string;
}): Promise<BatchSendResult> {
  const auth = await requireManagement();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return { ok: false, error: "Server isn't configured to send (missing SUPABASE_URL / service-role key)." };
  }

  const ids = (input.ids ?? []).filter((s) => /^(csr_|est_)/.test(s)).slice(0, MAX_PER_CALL);
  if (ids.length === 0) return { ok: false, error: "No sendable estimate ids in this chunk." };

  const toEmail = String(input.toEmail ?? "").trim();
  if (input.test && !toEmail) return { ok: false, error: "A test batch needs the staff inbox to send to." };

  const results: BatchItemResult[] = [];
  for (const id of ids) {
    const body: Record<string, unknown> = {
      hcp_estimate_id: id,
      created_by: `${auth.email}:batch${input.test ? "-test" : ""}`,
    };
    if (input.test) {
      body.test = true;
      body.to_email = toEmail;
    }
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/send-estimate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const j = (await r.json()) as { ok?: boolean; deduped?: boolean; error?: string };
      results.push(j.ok ? { id, ok: true, deduped: j.deduped === true } : { id, ok: false, error: j.error ?? `send failed (${r.status})` });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    await new Promise((res) => setTimeout(res, SPACING_MS));
  }
  return { ok: true, results };
}
