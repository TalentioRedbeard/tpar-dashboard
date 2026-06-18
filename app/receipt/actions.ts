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

export async function uploadReceipt(formData: FormData): Promise<UploadReceiptResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite && !me?.isManager) return { ok: false, error: "Not signed in or no write access." };

  const photo = formData.get("photo") as File | null;
  const invoiceNumber = (formData.get("invoice_number") as string | null)?.trim() || null;
  const amountStr = (formData.get("amount") as string | null)?.trim() || null;
  const vendor = (formData.get("vendor") as string | null)?.trim() || null;
  const notes = (formData.get("notes") as string | null)?.trim() || null;

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
      week_label: wk.label,
      week_start: wk.start,
      week_end: wk.end,
      source_file: "dashboard:receipt",
      source_row_index: 0,
      source_section: "dashboard-receipt-page",
      source: "dashboard",
      transaction_date: today,
      amount,
      vendor_description: vendor,
      invoice_number: invoiceNumber,
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
}): Promise<UploadReceiptResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite && !me?.isManager) return { ok: false, error: "Not signed in or no write access." };
  const path = String(input.path ?? "").trim();
  if (!path) return { ok: false, error: "Missing upload path." };

  const invoiceNumber = input.invoice_number?.trim() || null;
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
      week_label: wk.label,
      week_start: wk.start,
      week_end: wk.end,
      source_file: "dashboard:receipt",
      source_row_index: 0,
      source_section: "dashboard-receipt-page",
      source: "dashboard",
      transaction_date: today,
      amount,
      vendor_description: vendor,
      invoice_number: invoiceNumber,
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
    return { ok: false, error: insErr?.message ?? "Insert failed" };
  }

  revalidatePath("/receipt");
  return { ok: true, receipt_id: row.id as number, photo_url: publicUrl.publicUrl };
}
