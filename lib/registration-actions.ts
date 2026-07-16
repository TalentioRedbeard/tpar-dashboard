"use server";

// Product registration (SPEC_2026-07-16_PRODUCT_REGISTRATION): snap the plate
// on the job, tether to the job so everything auto-fills, auto-note both
// profiles, register with the manufacturer in a weekly batch (v1 =
// assemble-and-copy, never auto-submit).
//
// Capture gate mirrors receipts (canWrite || isManager — the 2026-06-18
// manager carve-out precedent for operational logging); the batch verbs are
// management-gated.

import { db } from "@/lib/supabase";
import { getCurrentTech, requireManagement } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

// ── Company constants (registration forms want the installer's company) ─────
// Address confirmed from tulsapar.com 2026-07-16.
export type TparCompany = {
  name: string; address: string; city: string; state: string; zip: string; phone: string;
};
const TPAR_COMPANY: TparCompany = {
  name: "Tulsa Plumbing and Remodeling LLC",
  address: "1515 E 6th St",
  city: "Tulsa",
  state: "OK",
  zip: "74120",
  phone: "(918) 800-4426",
};
export async function tparCompany(): Promise<TparCompany> { return TPAR_COMPANY; }

// ── Manufacturer registry (constants v1; a table only if it grows) ──────────
export type Manufacturer = { brand: string; url: string; phone: string };
const MANUFACTURERS: Manufacturer[] = [
  { brand: "Bosch", url: "https://www.boschprohvac.com/register", phone: "1-800-283-3787" },
  // B4: company tools — One-Key is Milwaukee's tracking platform; warranty
  // registration is separate (both live behind the same login).
  { brand: "Milwaukee", url: "https://onekey.milwaukeetool.com", phone: "1-800-729-3878" },
];
export async function manufacturerRegistry(): Promise<Manufacturer[]> { return MANUFACTURERS; }
export async function manufacturerFor(brand: string | null): Promise<Manufacturer | null> {
  if (!brand) return null;
  const b = brand.trim().toLowerCase();
  return MANUFACTURERS.find((m) => m.brand.toLowerCase() === b) ?? null;
}

const ENERGY_TYPES = new Set(["NG", "LP", "Oil", "Electric"]);

// ── Upload-first (same law as receipts: 1MB action body / 4.5MB Vercel cap) ─
export async function createRegistrationUpload(input: { filename?: string }): Promise<
  | { ok: true; path: string; token: string }
  | { ok: false; error: string }
> {
  const me = await getCurrentTech();
  if (!me?.canWrite && !me?.isManager) return { ok: false, error: "Not signed in or no write access." };
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = (input.filename?.split(".").pop()?.toLowerCase() || "jpg").replace(/[^a-z0-9]/g, "") || "jpg";
  const submitter = (me.tech?.tech_short_name ?? me.email).replace(/[^a-z0-9]/gi, "_");
  const path = `registrations/${ts}-${submitter}.${ext}`;
  const { data: signed, error } = await db().storage.from("job-photos").createSignedUploadUrl(path);
  if (error || !signed?.token) return { ok: false, error: `Could not start upload: ${error?.message ?? "no token"}` };
  return { ok: true, path: signed.path ?? path, token: signed.token };
}

// ── Vision extract (label-photo kind=product_plate, respond-only) ───────────
export type PlateExtract = {
  brand: string | null; model: string | null; serial_number: string | null;
  energy_type: string | null; confidence: string | null; notes: string | null;
};
export async function extractProductPlate(input: { path: string }): Promise<
  | { ok: true; extracted: PlateExtract }
  | { ok: false; error: string }
> {
  const me = await getCurrentTech();
  if (!me?.canWrite && !me?.isManager) return { ok: false, error: "Not signed in or no write access." };
  const { data: pub } = db().storage.from("job-photos").getPublicUrl(input.path);
  const r = await fetch(`${process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/label-photo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ kind: "product_plate", url: pub.publicUrl }),
    signal: AbortSignal.timeout(45_000),
  });
  const j = await r.json().catch(() => null) as { ok?: boolean; extracted?: PlateExtract & { is_product_plate?: boolean }; error?: string } | null;
  if (!r.ok || !j?.ok || !j.extracted) return { ok: false, error: j?.error ?? `extract failed (${r.status})` };
  if (j.extracted.is_product_plate === false) {
    return { ok: false, error: "That photo doesn't look like a product plate or registration card — fields left blank." };
  }
  const e = j.extracted;
  return {
    ok: true,
    extracted: {
      brand: e.brand ?? null,
      model: e.model ?? null,
      serial_number: e.serial_number ?? null,
      energy_type: e.energy_type && ENERGY_TYPES.has(e.energy_type) ? e.energy_type : null,
      confidence: e.confidence ?? null,
      notes: e.notes ?? null,
    },
  };
}

// ── Job tether: everything auto-fills from the job ───────────────────────────
export type JobTether = {
  hcp_job_id: string; hcp_customer_id: string | null; customer_name: string | null;
  address: string | null; install_date: string | null;
};
export async function tetherJob(input: { invoiceOrJobId: string }): Promise<
  | { ok: true; tether: JobTether }
  | { ok: false; error: string }
> {
  const me = await getCurrentTech();
  if (!me?.canWrite && !me?.isManager) return { ok: false, error: "Not signed in or no write access." };
  const q = input.invoiceOrJobId.trim();
  if (!q) return { ok: false, error: "No job given." };
  const supa = db();
  const col = q.startsWith("job_") ? "hcp_job_id" : "hcp_invoice_number";
  const { data } = await supa
    .from("jobs_master")
    .select("hcp_job_id, hcp_customer_id, customer_name, address, job_scheduled_start_date")
    .eq(col, q)
    .order("job_scheduled_start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { ok: false, error: `No job found for "${q}".` };
  return {
    ok: true,
    tether: {
      hcp_job_id: data.hcp_job_id as string,
      hcp_customer_id: (data.hcp_customer_id as string | null) ?? null,
      customer_name: (data.customer_name as string | null) ?? null,
      address: (data.address as string | null) ?? null,
      install_date: data.job_scheduled_start_date ? String(data.job_scheduled_start_date).slice(0, 10) : null,
    },
  };
}

// ── Save: the row + auto-notes on BOTH profiles ──────────────────────────────
export async function saveRegistration(input: {
  photoPath: string | null;
  kind?: "customer_product" | "company_tool";
  hcpJobId?: string | null;
  hcpCustomerId?: string | null;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  energyType?: string | null;
  installDate?: string | null;
  startupDate?: string | null;
  assignedTo?: string | null;         // company_tool only
  oneKeyRegistered?: boolean | null;  // company_tool only
  notes?: string | null;
  extracted?: unknown;
}): Promise<{ ok: true; id: number; noted: boolean } | { ok: false; error: string }> {
  const me = await getCurrentTech();
  if (!me?.canWrite && !me?.isManager) return { ok: false, error: "Not signed in or no write access." };
  const supa = db();

  const kind = input.kind === "company_tool" ? "company_tool" : "customer_product";
  const isTool = kind === "company_tool";
  const energy = input.energyType && ENERGY_TYPES.has(input.energyType) ? input.energyType : null;
  const photoUrl = input.photoPath
    ? supa.storage.from("job-photos").getPublicUrl(input.photoPath).data.publicUrl
    : null;
  const installedBy = me.tech?.tech_short_name ?? me.email;

  const { data: row, error } = await supa
    .from("product_registrations")
    .insert({
      kind,
      // Company tools never tether to customer work — even if a job id sneaks
      // in (bought FOR a job), the tool is ours, not the customer's record.
      hcp_job_id: isTool ? null : input.hcpJobId?.trim() || null,
      hcp_customer_id: isTool ? null : input.hcpCustomerId?.trim() || null,
      brand: input.brand?.trim() || null,
      model: input.model?.trim() || null,
      serial_number: input.serialNumber?.trim() || null,
      energy_type: isTool ? null : energy,
      install_date: isTool ? null : input.installDate || null,
      startup_date: isTool ? null : input.startupDate || input.installDate || null,
      assigned_to: isTool ? input.assignedTo?.trim() || null : null,
      one_key_registered: isTool ? input.oneKeyRegistered ?? false : null,
      installed_by: installedBy,
      photo_url: photoUrl,
      extracted: input.extracted ?? null,
      notes: input.notes?.trim() || null,
      created_by: me.email,
    })
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: error?.message ?? "insert failed" };

  // Auto-note both profiles (Danny's explicit ask — findable from the pages
  // people already open years later). Direct inserts with the same shape
  // notes-actions uses: requireWriter would refuse managers, but this is
  // operational capture (the receipts manager carve-out class, 2026-06-18).
  // Gated on kind, not just presence of ids: a company tool must NEVER note a
  // customer profile.
  let noted = false;
  if (!isTool && (input.hcpJobId?.trim() || input.hcpCustomerId?.trim())) {
    const body =
      `🏷️ Product installed: ${input.brand ?? "unknown brand"} ${input.model ?? ""}`.trim() +
      `${input.serialNumber ? `, serial ${input.serialNumber}` : ""}` +
      `${energy ? `, ${energy}` : ""}` +
      `${input.installDate ? `, installed ${input.installDate}` : ""} by ${installedBy}. ` +
      `Registration pending.${photoUrl ? ` Photo: ${photoUrl}` : ""}`;
    const results: Array<{ error: { message: string } | null }> = [];
    if (input.hcpCustomerId?.trim()) {
      results.push(await supa.from("customer_notes").insert({ hcp_customer_id: input.hcpCustomerId.trim(), author_email: me.email, body }));
    }
    if (input.hcpJobId?.trim()) {
      results.push(await supa.from("job_notes").insert({ hcp_job_id: input.hcpJobId.trim(), author_email: me.email, body }));
    }
    noted = results.length > 0 && results.every((r) => !r.error);
    if (input.hcpCustomerId?.trim()) revalidatePath(`/customer/${input.hcpCustomerId.trim()}`);
    if (input.hcpJobId?.trim()) revalidatePath(`/job/${input.hcpJobId.trim()}`);
  }

  revalidatePath("/shopping");
  return { ok: true, id: row.id as number, noted };
}

// ── Batch (leadership): pending list + verbs ─────────────────────────────────
export type PendingRegistration = {
  id: number; hcp_job_id: string | null; hcp_customer_id: string | null;
  kind: "customer_product" | "company_tool";
  brand: string | null; model: string | null; serial_number: string | null;
  energy_type: string | null; install_date: string | null; startup_date: string | null;
  assigned_to: string | null; one_key_registered: boolean | null;
  installed_by: string | null; photo_url: string | null; notes: string | null;
  customer_name: string | null; job_address: string | null; created_at: string;
};

export async function listPendingRegistrations(): Promise<
  | { ok: true; rows: PendingRegistration[] }
  | { ok: false; error: string }
> {
  const gate = await requireManagement();
  if (!gate.ok) return { ok: false, error: gate.error };
  const supa = db();
  const { data, error } = await supa
    .from("product_registrations")
    .select("id, hcp_job_id, hcp_customer_id, kind, brand, model, serial_number, energy_type, install_date, startup_date, assigned_to, one_key_registered, installed_by, photo_url, notes, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as Array<Omit<PendingRegistration, "customer_name" | "job_address">>;

  // Enrich with the tether's customer/address (registration forms want them).
  const jobIds = [...new Set(rows.map((r) => r.hcp_job_id).filter((x): x is string => !!x))];
  const jobInfo = new Map<string, { customer_name: string | null; address: string | null }>();
  for (let i = 0; i < jobIds.length; i += 100) {
    const { data: jm } = await supa
      .from("jobs_master")
      .select("hcp_job_id, customer_name, address")
      .in("hcp_job_id", jobIds.slice(i, i + 100));
    for (const j of (jm ?? []) as Array<{ hcp_job_id: string; customer_name: string | null; address: string | null }>) {
      jobInfo.set(j.hcp_job_id, { customer_name: j.customer_name, address: j.address });
    }
  }
  return {
    ok: true,
    rows: rows.map((r) => ({
      ...r,
      customer_name: r.hcp_job_id ? jobInfo.get(r.hcp_job_id)?.customer_name ?? null : null,
      job_address: r.hcp_job_id ? jobInfo.get(r.hcp_job_id)?.address ?? null : null,
    })),
  };
}

async function appendRegistrationNote(
  reg: { hcp_job_id: string | null; hcp_customer_id: string | null; brand: string | null; model: string | null },
  line: string,
  authorEmail: string,
) {
  const supa = db();
  const body = `🏷️ ${reg.brand ?? ""} ${reg.model ?? ""} — ${line}`.replace(/\s+/g, " ").trim();
  if (reg.hcp_customer_id) {
    await supa.from("customer_notes").insert({ hcp_customer_id: reg.hcp_customer_id, author_email: authorEmail, body });
    revalidatePath(`/customer/${reg.hcp_customer_id}`);
  }
  if (reg.hcp_job_id) {
    await supa.from("job_notes").insert({ hcp_job_id: reg.hcp_job_id, author_email: authorEmail, body });
    revalidatePath(`/job/${reg.hcp_job_id}`);
  }
}

export async function markRegistered(input: { id: number; confirmationRef?: string }): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireManagement();
  if (!gate.ok) return { ok: false, error: gate.error };
  const supa = db();
  const { data: reg, error: readErr } = await supa
    .from("product_registrations")
    .select("id, hcp_job_id, hcp_customer_id, brand, model, status")
    .eq("id", input.id).maybeSingle();
  if (readErr || !reg) return { ok: false, error: readErr?.message ?? "not found" };
  if (reg.status !== "pending") return { ok: false, error: `already ${reg.status}` };
  const { error } = await supa
    .from("product_registrations")
    .update({
      status: "registered",
      registered_at: new Date().toISOString(),
      registered_by: gate.email,
      confirmation_ref: input.confirmationRef?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  await appendRegistrationNote(
    reg as { hcp_job_id: string | null; hcp_customer_id: string | null; brand: string | null; model: string | null },
    `Registration ✅ ${new Date().toISOString().slice(0, 10)}${input.confirmationRef?.trim() ? ` (conf: ${input.confirmationRef.trim()})` : ""}`,
    gate.email,
  );
  revalidatePath("/shopping");
  return { ok: true };
}

// B4: One-Key (Milwaukee tracking) is a SEPARATE state from manufacturer
// warranty registration — folding it into markRegistered would lose the
// saw-died-unregistered lesson. Management-gated like the other batch verbs.
export async function setOneKeyRegistered(input: { id: number; value: boolean }): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireManagement();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { error } = await db()
    .from("product_registrations")
    .update({ one_key_registered: input.value, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("kind", "company_tool");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/shopping");
  return { ok: true };
}

export async function markNotNeeded(input: { id: number; why: string }): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireManagement();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.why?.trim()) return { ok: false, error: "Say why it isn't needed." };
  const supa = db();
  const { error } = await supa
    .from("product_registrations")
    .update({
      status: "not_needed",
      registered_by: gate.email,
      notes: input.why.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/shopping");
  return { ok: true };
}
