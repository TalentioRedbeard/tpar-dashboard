"use server";

// Server actions for the 4-question multi-option estimate builder
// (components/MultiOptionEstimateBuilder, route /estimate/new). Each option is
// built via the pricebook cascade + hours/crew/materials math (same as
// AddJobLineItem), so prices arrive already computed in CENTS. Pushes to HCP via
// the proven create-estimate-direct edge fn — identical body shape to
// createEstimateForJob (lib/estimate-actions), just customer-scoped instead of
// job-scoped (an HCP estimate attaches to a customer + address, not a job).

import { revalidatePath } from "next/cache";
import { requireWriter } from "./current-tech";
import { db } from "./supabase";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SECRET = process.env.CREATE_ESTIMATE_DIRECT_SECRET ?? "";

export type EstLineInput = {
  name: string;
  description?: string;
  quantity: number;
  unit_price_cents: number;
  unit_cost_cents?: number;
};
export type EstOptionInput = { name: string; line_items: EstLineInput[] };

export type CreateMultiOptionInput = {
  hcpCustomerId: string;
  addressId?: string;
  note?: string;
  message?: string;
  options: EstOptionInput[];
};

export type EstimateResult =
  | { ok: true; estimate_id: string; estimate_number: string; hcp_url: string | null }
  | { ok: false; error: string };

export async function createMultiOptionEstimate(input: CreateMultiOptionInput): Promise<EstimateResult> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };
  if (!SUPABASE_URL || !SECRET) return { ok: false, error: "server config missing" };

  const hcpCustomerId = String(input.hcpCustomerId ?? "").trim();
  // Every HCP customer id is cus_…; reject anything else early with a clear
  // message rather than a generic HCP 502 deep in the call.
  if (!hcpCustomerId || !hcpCustomerId.startsWith("cus_")) return { ok: false, error: "A valid customer is required." };

  // Validate + normalize options. Allow $0 unit_price so a descriptive option
  // can be pushed and priced later (field workflow, matches createEstimateForJob).
  const options: EstOptionInput[] = (input.options ?? [])
    .map((o) => ({
      name: (o.name || "Option").slice(0, 255),
      line_items: (o.line_items ?? [])
        .filter((li) => li.name && li.name.trim() && Number(li.quantity) > 0 && Number.isInteger(li.unit_price_cents) && li.unit_price_cents >= 0)
        .map((li) => {
          const out: EstLineInput = {
            name: li.name.trim().slice(0, 255),
            quantity: Number(li.quantity),
            unit_price_cents: Number(li.unit_price_cents),
          };
          if (li.description && li.description.trim()) out.description = li.description.trim().slice(0, 1000);
          if (Number.isInteger(li.unit_cost_cents)) out.unit_cost_cents = Number(li.unit_cost_cents);
          return out;
        }),
    }))
    .filter((o) => o.line_items.length > 0);

  if (options.length === 0) {
    // $0 is allowed on purpose (describe the option now, fill price in HCP
    // later — matches createEstimateForJob); the requirement is just a picked item.
    return { ok: false, error: "Add at least one option with a line item — pick an item (price can be $0 and filled in HCP later)." };
  }

  const body: Record<string, unknown> = { hcp_customer_id: hcpCustomerId, options };
  if (input.addressId) body.address_id = input.addressId;
  if (input.note && input.note.trim()) body.note = input.note.trim().slice(0, 8000);
  if (input.message && input.message.trim()) body.message = input.message.trim().slice(0, 8000);

  const r = await fetch(`${SUPABASE_URL}/functions/v1/create-estimate-direct`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Trigger-Secret": SECRET },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) return { ok: false, error: `HCP push failed: ${r.status} ${text.slice(0, 400)}` };

  let parsed: { ok?: boolean; error?: string; estimate_id?: string; estimate_number?: string; hcp_url?: string | null };
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "non-JSON response from create-estimate-direct" }; }
  if (!parsed.ok) return { ok: false, error: parsed.error ?? "create-estimate-direct returned ok=false" };

  const supa = db();
  await supa.from("maintenance_logs").insert({
    source: "dashboard-multi-option-estimate",
    level: "info",
    message: "multi-option estimate pushed from dashboard (4Q builder)",
    context: {
      hcp_customer_id: hcpCustomerId,
      author_email: writer.email,
      estimate_id: parsed.estimate_id,
      estimate_number: parsed.estimate_number,
      option_count: options.length,
      line_count: options.reduce((n, o) => n + o.line_items.length, 0),
    },
  });

  // The estimate attaches to the customer — refresh the customer page so its
  // "Open estimates" card picks it up (after the next HCP sync).
  revalidatePath(`/customer/${hcpCustomerId}`);
  revalidatePath("/estimates");

  return {
    ok: true,
    estimate_id: parsed.estimate_id ?? "",
    estimate_number: parsed.estimate_number ?? "",
    hcp_url: parsed.hcp_url ?? null,
  };
}

// Customer search for the standalone builder (estimates page / dashboard, where
// no customer is pre-scoped). Mirrors dispatch/new-estimate searchCustomers but
// gated to writers (anyone who can create an estimate). Returns addresses too so
// the builder can optionally pin the estimate to a specific service address.
export type EstimateCustomerHit = {
  hcp_customer_id: string;
  display_name: string;
  email: string | null;
  phone10: string | null;
  addresses: Array<{ address_id: string; street: string; city: string }>;
};

export async function searchEstimateCustomers(q: string): Promise<EstimateCustomerHit[]> {
  const writer = await requireWriter();
  if (!writer.ok) return [];
  const term = q.trim();
  if (term.length < 2) return [];

  const supa = db();
  const { data: customers } = await supa
    .from("customers_master")
    .select("hcp_customer_id, name, first_name, last_name, email, phone10")
    .or(`name.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,phone10.eq.${term.replace(/\D/g, "")}`)
    .limit(15);
  if (!customers || customers.length === 0) return [];

  const ids = customers.map((c) => c.hcp_customer_id);
  const { data: rawJobs } = await supa
    .from("hcp_jobs_raw")
    .select("hcp_customer_id, raw")
    .in("hcp_customer_id", ids)
    .order("scheduled_start", { ascending: false, nullsFirst: false })
    .limit(200);

  const addrsByCustomer = new Map<string, Map<string, { street: string; city: string }>>();
  for (const r of (rawJobs ?? []) as Array<{ hcp_customer_id: string; raw: Record<string, unknown> }>) {
    const addr = (r.raw?.["address"] ?? {}) as Record<string, unknown>;
    const aid = typeof addr["id"] === "string" ? addr["id"] : null;
    if (!aid) continue;
    const street = typeof addr["street"] === "string" ? addr["street"] : "";
    const city = typeof addr["city"] === "string" ? addr["city"] : "";
    if (!addrsByCustomer.has(r.hcp_customer_id)) addrsByCustomer.set(r.hcp_customer_id, new Map());
    addrsByCustomer.get(r.hcp_customer_id)!.set(aid, { street, city });
  }

  return customers.map((c) => {
    const addrs = Array.from((addrsByCustomer.get(c.hcp_customer_id) ?? new Map()).entries())
      .map(([address_id, v]) => ({ address_id, street: (v as { street: string }).street, city: (v as { city: string }).city }));
    const name = c.name ?? [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ?? "(unnamed)";
    return {
      hcp_customer_id: c.hcp_customer_id,
      display_name: name || "(unnamed)",
      email: c.email ?? null,
      phone10: c.phone10 ?? null,
      addresses: addrs,
    };
  });
}
