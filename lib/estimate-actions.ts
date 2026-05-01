// Server action: push a multi-option estimate to HCP via the existing
// create-estimate-direct edge function. Used by /job/[id]/estimate/new.
//
// Auth: any signed-in user on the allowlist (server actions inherit
// middleware enforcement). Author email captured for audit.

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "./supabase-server";
import { db } from "./supabase";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SECRET = process.env.CREATE_ESTIMATE_DIRECT_SECRET ?? "";

type LineItemInput = {
  name: string;
  description?: string;
  unit_price_cents: number;
  unit_cost_cents?: number;
  quantity: number;
};

type OptionInput = { name: string; line_items: LineItemInput[] };

export type EstimateResult =
  | { ok: true; estimate_id: string; estimate_number: string; hcp_url: string | null }
  | { ok: false; error: string };

export async function createEstimateForJob(formData: FormData): Promise<EstimateResult> {
  const user = await getSessionUser();
  if (!user?.email) return { ok: false, error: "not signed in" };
  if (!SUPABASE_URL || !SECRET) return { ok: false, error: "server config missing" };

  const hcpJobId = String(formData.get("hcp_job_id") ?? "").trim();
  const note     = String(formData.get("note") ?? "").trim();
  const message  = String(formData.get("message") ?? "").trim();
  if (!hcpJobId) return { ok: false, error: "hcp_job_id required" };

  // Pull customer + address from job_360 → required by create-estimate-direct
  const supa = db();
  const { data: job, error: jobErr } = await supa
    .from("job_360")
    .select("hcp_customer_id, address_id")
    .eq("hcp_job_id", hcpJobId)
    .maybeSingle();
  if (jobErr || !job) return { ok: false, error: `job lookup: ${jobErr?.message ?? "not found"}` };
  const hcpCustomerId = job.hcp_customer_id as string | null;
  if (!hcpCustomerId) return { ok: false, error: "job has no hcp_customer_id" };

  // Form encodes options + line items as repeating fields:
  //   options[0][name]
  //   options[0][line_items][0][name]
  //   options[0][line_items][0][quantity]
  //   options[0][line_items][0][unit_price] (dollars; we convert)
  //   options[0][line_items][0][description]
  //   options[1][name] ...etc
  // We parse from FormData entries.

  const optionMap = new Map<number, OptionInput>();
  for (const [key, raw] of formData.entries()) {
    const m = key.match(/^options\[(\d+)\]\[(name|line_items)\](?:\[(\d+)\]\[(name|description|quantity|unit_price|unit_cost)\])?$/);
    if (!m) continue;
    const optIdx = Number(m[1]);
    if (!optionMap.has(optIdx)) optionMap.set(optIdx, { name: "", line_items: [] });
    const opt = optionMap.get(optIdx)!;
    if (m[2] === "name" && !m[3]) {
      opt.name = String(raw).trim();
    } else if (m[2] === "line_items" && m[3] !== undefined) {
      const liIdx = Number(m[3]);
      while (opt.line_items.length <= liIdx) opt.line_items.push({ name: "", quantity: 1, unit_price_cents: 0 });
      const li = opt.line_items[liIdx];
      const v = String(raw).trim();
      switch (m[4]) {
        case "name":        li.name = v; break;
        case "description": li.description = v || undefined; break;
        case "quantity":    li.quantity = Number(v) || 1; break;
        case "unit_price":  li.unit_price_cents = Math.round((Number(v) || 0) * 100); break;
        case "unit_cost":   li.unit_cost_cents = v === "" ? undefined : Math.round((Number(v) || 0) * 100); break;
      }
    }
  }

  // Sort + filter
  const options = [...optionMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, o]) => ({
      name: o.name || "Option",
      line_items: o.line_items.filter((li) => li.name && li.unit_price_cents > 0 && li.quantity > 0),
    }))
    .filter((o) => o.line_items.length > 0);

  if (options.length === 0) {
    return { ok: false, error: "Add at least one option with at least one line item (name + price + quantity)." };
  }

  const body: Record<string, unknown> = {
    hcp_customer_id: hcpCustomerId,
    options,
  };
  if (job.address_id) body.address_id = job.address_id;
  if (note) body.note = note.slice(0, 8000);
  if (message) body.message = message.slice(0, 8000);

  const r = await fetch(`${SUPABASE_URL}/functions/v1/create-estimate-direct`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Trigger-Secret": SECRET },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) return { ok: false, error: `HCP push failed: ${r.status} ${text.slice(0, 400)}` };

  let parsed: { ok?: boolean; error?: string; estimate_id?: string; estimate_number?: string; hcp_url?: string | null };
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "non-JSON response" }; }
  if (!parsed.ok) return { ok: false, error: parsed.error ?? "create-estimate-direct returned ok=false" };

  // Audit
  await supa.from("maintenance_logs").insert({
    source: "dashboard-estimate-create",
    level: "info",
    message: `estimate pushed from dashboard`,
    context: {
      hcp_job_id: hcpJobId,
      hcp_customer_id: hcpCustomerId,
      author_email: user.email,
      estimate_id: parsed.estimate_id,
      estimate_number: parsed.estimate_number,
      option_count: options.length,
      line_count: options.reduce((n, o) => n + o.line_items.length, 0),
    },
  });

  revalidatePath(`/job/${hcpJobId}`);

  return {
    ok: true,
    estimate_id: parsed.estimate_id ?? "",
    estimate_number: parsed.estimate_number ?? "",
    hcp_url: parsed.hcp_url ?? null,
  };
}

export type SendResult =
  | { ok: true; sent_at: string | null; sent_to: string | null; sent_method: string | null }
  | { ok: false; error: string };

export async function sendEstimateToClient(formData: FormData): Promise<SendResult> {
  const user = await getSessionUser();
  if (!user?.email) return { ok: false, error: "not signed in" };
  if (!SUPABASE_URL || !SECRET) return { ok: false, error: "server config missing" };

  const estimateId = String(formData.get("estimate_id") ?? "").trim();
  const message    = String(formData.get("message") ?? "").trim();
  if (!estimateId) return { ok: false, error: "estimate_id required" };

  const r = await fetch(`${SUPABASE_URL}/functions/v1/create-estimate-direct`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Trigger-Secret": SECRET },
    body: JSON.stringify({
      op: "send_to_customer",
      estimate_id: estimateId,
      ...(message ? { message } : {}),
    }),
  });
  const text = await r.text();
  if (!r.ok) return { ok: false, error: `HCP send failed: ${r.status} ${text.slice(0, 400)}` };

  let parsed: { ok?: boolean; error?: string; sent_at?: string; sent_to?: string; sent_method?: string };
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "non-JSON response" }; }
  if (!parsed.ok) return { ok: false, error: parsed.error ?? "send returned ok=false" };

  // Audit
  const supa = db();
  await supa.from("maintenance_logs").insert({
    source: "dashboard-estimate-send",
    level: "info",
    message: `estimate sent to customer from dashboard`,
    context: {
      estimate_id: estimateId,
      author_email: user.email,
      sent_at: parsed.sent_at ?? null,
      sent_to: parsed.sent_to ?? null,
      sent_method: parsed.sent_method ?? null,
    },
  });

  return {
    ok: true,
    sent_at: parsed.sent_at ?? null,
    sent_to: parsed.sent_to ?? null,
    sent_method: parsed.sent_method ?? null,
  };
}
