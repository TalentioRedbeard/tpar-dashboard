"use server";

// Server actions for the web /receipt upload flow.
// Mirrors the Slack /receipt flow but keeps everything in the dashboard.
//
// Storage: uploads photo to the existing 'job-photos' bucket
// DB: writes to receipts_master with source='dashboard'

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

// Mon–Sun week containing `now`. receipts_master requires week_label/week_start/
// week_end + source_file/source_row_index/source_section (all NOT NULL, no
// default) — omitting them is what made EVERY dashboard receipt insert fail with
// 23502 and never save once (audit 2026-06-12). Mirrors lib/job-cost-actions.ts
// weekBounds; kept local because that file is "use server" and a "use server"
// module can only export async functions.
function weekBounds(now: Date): { label: string; start: string; end: string } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMon = (d.getUTCDay() + 6) % 7;
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - sinceMon);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { label: iso(mon), start: iso(mon), end: iso(sun) };
}

export type UploadReceiptResult =
  | { ok: true; receipt_id: number; photo_url: string }
  | { ok: false; error: string };

// Non-job PO categories (SPEC_2026-07-16_RECEIPT_PO_CATEGORIES): the counter
// PO isn't always a job number — gas/tools/office/dining/other are first-class.
// Category → is_overhead + raw_po token + checked overhead_category column.
const OVERHEAD_CATEGORIES = new Set(["gas", "tools", "office", "dining", "other"]);

function resolveChargeTo(
  invoiceNumber: string | null,
  category: string | null,
):
  | { ok: true; fields: { invoice_number: string | null; is_overhead: boolean; raw_po: string | null; overhead_category: string | null } }
  | { ok: false; error: string } {
  const cat = category?.trim().toLowerCase() || null;
  if (cat && !OVERHEAD_CATEGORIES.has(cat)) return { ok: false, error: "Unknown overhead category." };
  if (cat && invoiceNumber) return { ok: false, error: "Pick a job # OR an overhead category — not both." };
  if (cat) {
    return { ok: true, fields: { invoice_number: null, is_overhead: true, raw_po: cat, overhead_category: cat } };
  }
  // Job # or neither — unchanged behavior (blank stays legal; sorted later).
  return { ok: true, fields: { invoice_number: invoiceNumber, is_overhead: false, raw_po: null, overhead_category: null } };
}

// B1 (2026-07-16): gas receipts carry vehicle_id + odometer_miles. Server-side
// re-validation: only persisted when the resolved category is gas; vehicle must
// be a real, active, shared vehicle; odometer a sane integer.
async function resolveVehicleFields(
  overheadCategory: string | null,
  vehicleId: string | null | undefined,
  odometerStr: string | null | undefined,
): Promise<
  | { ok: true; fields: { vehicle_id: string | null; odometer_miles: number | null } }
  | { ok: false; error: string }
> {
  if (overheadCategory !== "gas") return { ok: true, fields: { vehicle_id: null, odometer_miles: null } };
  let vehicle_id: string | null = null;
  const vid = vehicleId?.trim() || null;
  if (vid) {
    const { data: v } = await db()
      .from("vehicles_master")
      .select("id")
      .eq("id", vid)
      .eq("is_active", true)
      .eq("owner_only", false)
      .maybeSingle();
    if (!v) return { ok: false, error: "That vehicle isn't in the active fleet — pick one from the list." };
    vehicle_id = vid;
  }
  let odometer_miles: number | null = null;
  const os = odometerStr?.trim() || null;
  if (os) {
    const n = Math.round(Number(os.replace(/[^0-9.]/g, "")));
    if (!Number.isFinite(n) || n < 0 || n >= 2_000_000) {
      return { ok: false, error: "Odometer should be a mileage number (or leave it blank)." };
    }
    odometer_miles = n;
  }
  return { ok: true, fields: { vehicle_id, odometer_miles } };
}

export async function uploadReceipt(formData: FormData): Promise<UploadReceiptResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite && !me?.isManager) return { ok: false, error: "Not signed in or no write access." };

  const photo = formData.get("photo") as File | null;
  const invoiceNumber = (formData.get("invoice_number") as string | null)?.trim() || null;
  const amountStr = (formData.get("amount") as string | null)?.trim() || null;
  const vendor = (formData.get("vendor") as string | null)?.trim() || null;
  const notes = (formData.get("notes") as string | null)?.trim() || null;
  const chargeTo = resolveChargeTo(invoiceNumber, (formData.get("category") as string | null) ?? null);
  if (!chargeTo.ok) return { ok: false, error: chargeTo.error };

  if (!photo || photo.size === 0) {
    return { ok: false, error: "Photo is required." };
  }

  // Blank amount is the documented happy path (the field is "(optional)" and the
  // total often gets filled in later). receipts_master.amount is NOT NULL, so
  // coerce blank -> 0 to match every other ingest path (slack/email) instead of
  // throwing on insert and losing the tech's receipt.
  const amount = amountStr ? Number(amountStr.replace(/[^0-9.-]/g, "")) : 0;
  if (amountStr && (!Number.isFinite(amount) || amount < 0)) {
    return { ok: false, error: "Amount must be a positive number." };
  }

  const supabase = db();

  // Upload to job-photos bucket — receipts go here too for v0 to avoid bucket sprawl
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = photo.name.split(".").pop()?.toLowerCase() || "jpg";
  const submitter = me.tech?.tech_short_name ?? me.email;
  const path = `receipts/${ts}-${submitter}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("job-photos")
    .upload(path, photo, { contentType: photo.type, upsert: false });
  if (uploadErr) return { ok: false, error: `Upload failed: ${uploadErr.message}` };

  const { data: publicUrl } = supabase.storage.from("job-photos").getPublicUrl(path);

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const wk = weekBounds(now);
  const { data: row, error: insErr } = await supabase
    .from("receipts_master")
    .insert({
      // The 6 NOT-NULL columns receipts_master requires — omitting these is what
      // failed every dashboard receipt with 23502 (audit 2026-06-12).
      // source_file must be UNIQUE per submission: receipts_master_dedup_idx is
      // UNIQUE(source_file, source_section, source_row_index), and the old
      // static "dashboard:receipt" value let exactly ONE dashboard receipt ever
      // exist — every later one 23505'd and the tech's receipt was lost
      // (Landon, 2026-07-16). The photo path is unique per upload AND lineage.
      week_label: wk.label,
      week_start: wk.start,
      week_end: wk.end,
      source_file: `dashboard:${path}`,
      source_row_index: 0,
      source_section: "dashboard-receipt-page",
      source: "dashboard",
      transaction_date: today,
      amount,
      vendor_description: vendor,
      ...chargeTo.fields,
      // Legacy path takes no vehicle input; the live upload-first path does.
      tech_name: me.tech?.tech_short_name ?? null,
      photo_url: publicUrl.publicUrl,
      notes,
      slack_user_id: me.tech?.slack_user_id ?? null,
      has_paper_receipt: true,
    })
    .select("id")
    .single();

  if (insErr || !row) {
    // Don't leave the just-uploaded photo orphaned in the bucket if the row failed.
    await supabase.storage.from("job-photos").remove([path]).catch(() => {});
    if ((insErr as { code?: string } | null)?.code === "23505") {
      return { ok: false, error: "That receipt looks already logged (same photo). Check with the office before re-submitting." };
    }
    return { ok: false, error: insErr?.message ?? "Insert failed" };
  }

  revalidatePath("/receipt");
  return { ok: true, receipt_id: row.id as number, photo_url: publicUrl.publicUrl };
}

// ── Upload-first path (2026-06-08) ───────────────────────────────────────────
// The browser PUTs the receipt photo DIRECTLY to the job-photos bucket via a signed
// upload URL, bypassing Vercel's ~4.5MB server-action body cap (see
// reference_vercel_body_cap). createReceiptUpload mints the slot; finalizeReceipt
// records the receipts_master row. Mirrors the /photos + lib/recordings.ts pattern.

export type CreateReceiptUploadResult =
  | { ok: true; path: string; token: string }
  | { ok: false; error: string };

export async function createReceiptUpload(input: { filename?: string }): Promise<CreateReceiptUploadResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite && !me?.isManager) return { ok: false, error: "Not signed in or no write access." };
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = (input.filename?.split(".").pop()?.toLowerCase() || "jpg").replace(/[^a-z0-9]/g, "") || "jpg";
  const submitter = (me.tech?.tech_short_name ?? me.email).replace(/[^a-z0-9]/gi, "_");
  const path = `receipts/${ts}-${submitter}.${ext}`;
  const { data: signed, error } = await db().storage.from("job-photos").createSignedUploadUrl(path);
  if (error || !signed?.token) return { ok: false, error: `Could not start upload: ${error?.message ?? "no token"}` };
  return { ok: true, path: signed.path ?? path, token: signed.token };
}

export async function finalizeReceipt(input: {
  path: string;
  invoice_number?: string | null;
  amount?: string | null;
  vendor?: string | null;
  notes?: string | null;
  category?: string | null;
  vehicle_id?: string | null;
  odometer_miles?: string | null;
}): Promise<UploadReceiptResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite && !me?.isManager) return { ok: false, error: "Not signed in or no write access." };
  const path = String(input.path ?? "").trim();
  if (!path) return { ok: false, error: "Missing upload path." };

  const invoiceNumber = input.invoice_number?.trim() || null;
  const chargeTo = resolveChargeTo(invoiceNumber, input.category ?? null);
  if (!chargeTo.ok) return { ok: false, error: chargeTo.error };
  const vehicle = await resolveVehicleFields(chargeTo.fields.overhead_category, input.vehicle_id, input.odometer_miles);
  if (!vehicle.ok) return { ok: false, error: vehicle.error };
  const amountStr = input.amount?.trim() || null;
  const vendor = input.vendor?.trim() || null;
  const notes = input.notes?.trim() || null;

  // Same blank->0 coercion as uploadReceipt (receipts_master.amount is NOT NULL).
  const amount = amountStr ? Number(amountStr.replace(/[^0-9.-]/g, "")) : 0;
  if (amountStr && (!Number.isFinite(amount) || amount < 0)) {
    return { ok: false, error: "Amount must be a positive number." };
  }

  const supabase = db();
  const { data: publicUrl } = supabase.storage.from("job-photos").getPublicUrl(path);

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const wk = weekBounds(now);
  const { data: row, error: insErr } = await supabase
    .from("receipts_master")
    .insert({
      // The 6 NOT-NULL columns receipts_master requires — omitting these is what
      // failed every dashboard receipt with 23502 (audit 2026-06-12).
      // source_file must be UNIQUE per submission: receipts_master_dedup_idx is
      // UNIQUE(source_file, source_section, source_row_index), and the old
      // static "dashboard:receipt" value let exactly ONE dashboard receipt ever
      // exist — every later one 23505'd and the tech's receipt was lost
      // (Landon, 2026-07-16). The photo path is unique per upload AND lineage.
      week_label: wk.label,
      week_start: wk.start,
      week_end: wk.end,
      source_file: `dashboard:${path}`,
      source_row_index: 0,
      source_section: "dashboard-receipt-page",
      source: "dashboard",
      transaction_date: today,
      amount,
      vendor_description: vendor,
      ...chargeTo.fields,
      // B1: gas-only vehicle/odometer tether (null for every other category).
      ...vehicle.fields,
      tech_name: me.tech?.tech_short_name ?? null,
      photo_url: publicUrl.publicUrl,
      notes,
      slack_user_id: me.tech?.slack_user_id ?? null,
      has_paper_receipt: true,
    })
    .select("id")
    .single();

  if (insErr || !row) {
    // Don't leave the just-uploaded photo orphaned in the bucket if the row failed.
    await supabase.storage.from("job-photos").remove([path]).catch(() => {});
    if ((insErr as { code?: string } | null)?.code === "23505") {
      return { ok: false, error: "That receipt looks already logged (same photo). Check with the office before re-submitting." };
    }
    return { ok: false, error: insErr?.message ?? "Insert failed" };
  }

  revalidatePath("/receipt");
  return { ok: true, receipt_id: row.id as number, photo_url: publicUrl.publicUrl };
}
