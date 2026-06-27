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
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// An optional equipment/pricing modifier the builder can offer per option
// (e.g. excavator_daily). Data-driven from price_modifiers so rate edits flow
// through without a code change.
export type ModifierDef = {
  key: string;
  label: string;
  dailyRate: number;
  deliveryCharge: number;
  minIncrement: number;
};

// Fetch the excavator equipment-fee modifier definition. Returns null if it's
// not configured/active. Half-day-ceiling daily rental + flat delivery.
export async function getExcavatorModifier(): Promise<ModifierDef | null> {
  const writer = await requireWriter();
  if (!writer.ok) return null;
  const { data } = await db()
    .from("price_modifiers")
    .select("modifier_key, name, daily_rate, delivery_charge, min_increment")
    .eq("modifier_key", "excavator_daily")
    .eq("active", true)
    .maybeSingle();
  if (!data) return null;
  return {
    key: data.modifier_key as string,
    label: (data.name as string | null) ?? "Excavator equipment fee",
    dailyRate: Number(data.daily_rate) || 0,
    deliveryCharge: Number(data.delivery_charge) || 0,
    minIncrement: Number(data.min_increment) || 0.5,
  };
}

export type EstLineInput = {
  name: string;
  description?: string;
  quantity: number;
  unit_price_cents: number;
  unit_cost_cents?: number;
  // Labor hours for this line (carried for the first-class bid_estimate_lines
  // record only — NOT sent to HCP). create-estimate-direct ignores it.
  labor_hours?: number;
};
export type EstOptionInput = { name: string; line_items: EstLineInput[] };

export type CreateMultiOptionInput = {
  hcpCustomerId: string;
  // Customer display name (optional; the persist RPC falls back to customers_master).
  customerName?: string;
  addressId?: string;
  // HCP employee ids of the assigned tech(s). Without this HCP creates the
  // estimate with no technician. Inherited from the job when the builder is
  // opened from a job; otherwise chosen in the builder's tech picker.
  assignedEmployeeIds?: string[];
  // Set when the estimate is built from a job, so we can persist the
  // job↔estimate link (HCP itself can't link an API estimate to a job).
  hcpJobId?: string;
  note?: string;
  message?: string;
  options: EstOptionInput[];
};

export type EstimateResult =
  | {
      ok: true;
      // estimate_id is the HCP estimate id (cus_/est_…) returned by HCP.
      estimate_id: string;
      estimate_number: string;
      hcp_url: string | null;
      // The first-class TPAR estimate id (bid_estimates.id), persisted via
      // persist_builder_estimate. Null only if that best-effort persist failed
      // (the HCP push still succeeded). Drives the tracked-send + /estimate/[id]
      // deep link on the success screen.
      bid_estimate_id: string | null;
    }
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
  const mapped = (input.options ?? []).map((o, idx) => ({
    name: (o.name || `Option ${idx + 1}`).slice(0, 255),
    inputLineCount: (o.line_items ?? []).length,
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
        if (typeof li.labor_hours === "number" && Number.isFinite(li.labor_hours)) out.labor_hours = li.labor_hours;
        return out;
      }),
  }));

  // Server-side guard against the 2026-06-02 "only 1 of 2 options reached HCP"
  // bug: if the user built an option (≥1 line) but EVERY line failed validation
  // (e.g. no Item/Q4 picked → empty name), never silently send fewer options —
  // block with the option's name so nothing vanishes. Belt-and-suspenders to the
  // client-side guard in MultiOptionEstimateBuilder.submit().
  const dropped = mapped.filter((o) => o.inputLineCount > 0 && o.line_items.length === 0);
  if (dropped.length > 0) {
    return {
      ok: false,
      error: `Nothing sent — ${dropped.map((d) => `"${d.name}"`).join(", ")} ${dropped.length === 1 ? "has a line" : "have lines"} with no item/price picked. Pick the Item (Q4) or a Custom name on each option (price can be $0), or remove the empty line/option.`,
    };
  }

  const options: EstOptionInput[] = mapped
    .map((o) => ({ name: o.name, line_items: o.line_items }))
    .filter((o) => o.line_items.length > 0);

  if (options.length === 0) {
    // $0 is allowed on purpose (describe the option now, fill price in HCP
    // later — matches createEstimateForJob); the requirement is just a picked item.
    return { ok: false, error: "Add at least one option with a line item — pick an item (price can be $0 and filled in HCP later)." };
  }

  const body: Record<string, unknown> = { hcp_customer_id: hcpCustomerId, options };
  if (input.addressId) body.address_id = input.addressId;
  // Pass the assigned tech(s) so HCP doesn't drop the technician on the estimate.
  const assignedEmployeeIds = (input.assignedEmployeeIds ?? []).filter((s) => typeof s === "string" && s.trim());
  if (assignedEmployeeIds.length > 0) body.assigned_employee_ids = assignedEmployeeIds;
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
      hcp_job_id: input.hcpJobId ?? null,
      assigned_employee_ids: assignedEmployeeIds,
    },
  });

  // If built from a job, persist the job↔estimate link (HCP can't link an
  // API-created estimate to a job). Best-effort — a harmless no-op until the
  // job_estimate_links migration is applied.
  if (input.hcpJobId) {
    await supa.from("job_estimate_links").insert({
      hcp_job_id: input.hcpJobId,
      hcp_estimate_id: parsed.estimate_id ?? null,
      estimate_number: parsed.estimate_number ?? null,
      assigned_employee_ids: assignedEmployeeIds,
      created_by_email: writer.email,
      source: "dashboard-multi-option-estimate",
    });
    revalidatePath(`/job/${input.hcpJobId}`);
  }

  // ── Phase 1 spine reconnect: persist a FIRST-CLASS estimate ──────────────
  // Persist the builder's options/lines as bid_estimates + bid_estimate_lines
  // keyed to the freshly-created HCP estimate, so the estimate immediately shows
  // in estimate_pipeline_v WITH bid_estimate_id set → /e itemizes from the bid
  // lines and the tracked Resend send is reachable (ends estimate_sends=0).
  // Best-effort + non-fatal: if it fails, the HCP push still succeeded, so we
  // return ok with bid_estimate_id=null (the tracked send by hcp_estimate_id
  // still works once the estimate is in hcp_estimates_raw). Money: pass DOLLARS
  // (sell_price_dollars/materials_dollars) — the RPC stores dollars; the HCP push
  // above used cents on its own path.
  let bidEstimateId: string | null = null;
  if (parsed.estimate_id) {
    const persistOptions = options.map((o) => ({
      name: o.name,
      line_items: o.line_items.map((li) => ({
        name: li.name,
        description: li.description ?? null,
        quantity: li.quantity,
        sell_price_dollars: li.unit_price_cents / 100,
        materials_dollars: typeof li.unit_cost_cents === "number" ? li.unit_cost_cents / 100 : 0,
        labor_hours: typeof li.labor_hours === "number" ? li.labor_hours : 0,
      })),
    }));
    const { data: persisted, error: persistErr } = await supa.rpc("persist_builder_estimate", {
      p_payload: {
        hcp_estimate_id: parsed.estimate_id,
        hcp_estimate_number: parsed.estimate_number ?? null,
        hcp_customer_id: hcpCustomerId,
        hcp_address_id: input.addressId ?? null,
        hcp_job_id: input.hcpJobId ?? null,
        customer_name: input.customerName?.trim() || null,
        work_description: input.message?.trim() || null,
        scope_text: input.note?.trim() || null,
        created_by: writer.email,
        source: "dashboard_multi_option",
        options: persistOptions,
      },
    });
    if (persistErr) {
      await supa.from("maintenance_logs").insert({
        source: "dashboard-multi-option-estimate",
        level: "warn",
        message: "persist_builder_estimate failed (estimate still pushed to HCP)",
        context: { hcp_estimate_id: parsed.estimate_id, err: persistErr.message },
      });
    } else {
      bidEstimateId = (persisted as string | null) ?? null;
    }
  }

  // The estimate attaches to the customer — refresh the customer page so its
  // "Open estimates" card picks it up (after the next HCP sync).
  revalidatePath(`/customer/${hcpCustomerId}`);
  revalidatePath("/estimates");

  return {
    ok: true,
    estimate_id: parsed.estimate_id ?? "",
    estimate_number: parsed.estimate_number ?? "",
    hcp_url: parsed.hcp_url ?? null,
    bid_estimate_id: bidEstimateId,
  };
}

// ── Tracked send straight from the builder success screen ───────────────────
// Phase 1 spine reconnect: after the builder pushes + persists, the operator can
// send the branded, tracked Resend email in ONE more click — no detour through
// /estimate/[id]. Calls the proven send-estimate edge fn keyed by the HCP
// estimate id (service-role lane; the fn does its own service-role auth). The /e
// hosted view + open/click tracking + the follow-up engine all key off the
// estimate_sends row this creates. Writer-gated (admin/tech; managers blocked).
export type TrackedSendResult =
  | { ok: true; view_url: string | null }
  | { ok: false; error: string };

export async function sendBuilderEstimateTracked(
  hcpEstimateId: string,
  input?: { toEmail?: string; message?: string }
): Promise<TrackedSendResult> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { ok: false, error: "Server isn't configured to send yet (missing SUPABASE_URL / service-role key)." };
  }
  const id = String(hcpEstimateId ?? "").trim();
  if (!id) return { ok: false, error: "No HCP estimate id to send." };

  const body: Record<string, unknown> = { hcp_estimate_id: id, created_by: writer.email };
  if (input?.message && input.message.trim()) body.message = input.message.trim().slice(0, 8000);
  if (input?.toEmail && input.toEmail.trim()) body.to_email = input.toEmail.trim();

  let r: Response;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/send-estimate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "apikey": SERVICE_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: `Couldn't reach the send service: ${e instanceof Error ? e.message : String(e)}` };
  }

  const text = await r.text();
  let parsed: { ok?: boolean; error?: string; view_url?: string | null };
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: `Send service returned an unexpected response (${r.status}).` }; }

  if (!parsed.ok) {
    if (parsed.error === "no_recipient_email") {
      return { ok: false, error: "No email on file for this customer — enter a recipient email and try again." };
    }
    if (parsed.error === "estimate_not_found") {
      return { ok: false, error: "This estimate isn't ready to send yet — give HCP a few seconds to finish creating it, then try again." };
    }
    return { ok: false, error: parsed.error ?? `Send failed (${r.status}).` };
  }

  revalidatePath("/estimates");
  return { ok: true, view_url: parsed.view_url ?? null };
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

export type EstimateTech = {
  hcp_employee_id: string;
  tech_short_name: string;
  hcp_full_name: string;
  is_lead: boolean;
};

// Active techs assignable to an estimate (HCP employee id + display name).
// Mirrors dispatch/new-estimate's loadActiveTechs so the 4Q builder can assign a
// tech when no job context pre-fills one. Writers only.
export async function loadEstimateTechs(): Promise<EstimateTech[]> {
  const writer = await requireWriter();
  if (!writer.ok) return [];
  const { data } = await db()
    .from("tech_directory")
    .select("tech_short_name, hcp_full_name, hcp_employee_id, is_active, is_test, dashboard_role, is_lead")
    .eq("is_active", true)
    .neq("is_test", true)
    .in("dashboard_role", ["tech", "admin"])
    .not("hcp_employee_id", "is", null)
    .order("is_lead", { ascending: false })
    .order("tech_short_name");
  return (data ?? []).map((d) => ({
    hcp_employee_id: d.hcp_employee_id as string,
    tech_short_name: (d.tech_short_name as string | null) ?? "",
    hcp_full_name: (d.hcp_full_name as string | null) ?? "",
    is_lead: !!d.is_lead,
  }));
}

// ── (b) Whole-estimate write-up ──────────────────────────────────────────────
// Calls the generate-estimate-writeup edge fn (canonical Danny's Descriptions
// prompt + few-shot examples on Sonnet 4.6) and returns the full Summary /
// Work Description / Notes for the whole estimate — the rich write-up Danny
// asked for, vs. the thin per-line blurb. Service-role bearer (the fn does its
// own isServiceRoleRequest auth). Fills the builder's customer-facing message.
export type WriteupResult = { ok: true; writeup: string } | { ok: false; error: string };

export async function generateEstimateWriteup(input: {
  options: Array<{ name: string; line_items: Array<{ name: string; description?: string; customer_supplied?: boolean }> }>;
  customerName?: string;
  address?: string;
}): Promise<WriteupResult> {
  const writer = await requireWriter();
  if (!writer.ok) return { ok: false, error: writer.error };
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, error: "server config missing (service key)" };

  const options = (input.options ?? [])
    .map((o) => ({ name: o.name, line_items: (o.line_items ?? []).filter((li) => li.name && li.name.trim()) }))
    .filter((o) => o.line_items.length > 0);
  if (options.length === 0) return { ok: false, error: "Add at least one option with a line item first." };

  const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-estimate-writeup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ options, customer_name: input.customerName, address: input.address }),
  });
  const text = await r.text();
  if (!r.ok) return { ok: false, error: `write-up failed: ${r.status} ${text.slice(0, 200)}` };
  let parsed: { ok?: boolean; error?: string; writeup?: string };
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "non-JSON response from generate-estimate-writeup" }; }
  if (!parsed.ok) return { ok: false, error: parsed.error ?? "generate-estimate-writeup returned ok=false" };
  return { ok: true, writeup: parsed.writeup ?? "" };
}

// ── Phase 2: estimate modifier engine ────────────────────────────────────────
// Every ACTIVE price_modifiers row, with the full effect payload, for the
// searchable per-line modifier picker + the compute engine. Inactive rows
// (e.g. the cert modifiers seeded 2026-06-10 with placeholder rates) stay out
// of the picker until Danny sets the real rate and activates them.
export type EstimateModifier = {
  key: string;
  name: string;
  category: string;            // rate_adjustment | equipment_charge | permit | discount | promo | floor_price | specialty | certification
  effectType: string;          // hourly_rate_add | labor_multiplier | equipment_charge | permit | flat_discount | promo_price | floor_price
  manualApply: boolean;
  triggerDescription: string | null;
  notes: string | null;
  // Effect payloads (only the ones relevant to effectType are non-null)
  rateAddPerJob: number | null;
  rateAddPerAdditionalTech: number | null;
  laborMultiplier: number | null;
  dailyRate: number | null;
  deliveryCharge: number | null;
  minIncrement: number | null;
  floorAmount: number | null;
  floorHoursThreshold: number | null;
  hourlyRateAfterFloor: number | null;
  discountAmount: number | null;
  promoPrice: number | null;
  promoCovers: string | null;
};

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function loadEstimateModifiers(): Promise<EstimateModifier[]> {
  const writer = await requireWriter();
  if (!writer.ok) return [];
  const { data } = await db()
    .from("price_modifiers")
    .select("modifier_key, name, category, effect_type, manual_apply, trigger_description, notes, rate_add_per_job, rate_add_per_additional_tech, labor_multiplier, daily_rate, delivery_charge, min_increment, floor_amount, floor_hours_threshold, hourly_rate_after_floor, discount_amount, promo_price, promo_covers")
    .eq("active", true)
    .order("category")
    .order("name");
  return (data ?? []).map((m) => ({
    key: m.modifier_key as string,
    name: (m.name as string | null) ?? (m.modifier_key as string),
    category: (m.category as string | null) ?? "other",
    effectType: m.effect_type as string,
    manualApply: !!m.manual_apply,
    triggerDescription: (m.trigger_description as string | null) ?? null,
    notes: (m.notes as string | null) ?? null,
    rateAddPerJob: numOrNull(m.rate_add_per_job),
    rateAddPerAdditionalTech: numOrNull(m.rate_add_per_additional_tech),
    laborMultiplier: numOrNull(m.labor_multiplier),
    dailyRate: numOrNull(m.daily_rate),
    deliveryCharge: numOrNull(m.delivery_charge),
    minIncrement: numOrNull(m.min_increment),
    floorAmount: numOrNull(m.floor_amount),
    floorHoursThreshold: numOrNull(m.floor_hours_threshold),
    hourlyRateAfterFloor: numOrNull(m.hourly_rate_after_floor),
    discountAmount: numOrNull(m.discount_amount),
    promoPrice: numOrNull(m.promo_price),
    promoCovers: (m.promo_covers as string | null) ?? null,
  }));
}
