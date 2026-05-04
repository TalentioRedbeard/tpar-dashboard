"use server";

// Server actions for the web /receipt upload flow.
// Mirrors the Slack /receipt flow but keeps everything in the dashboard.
//
// Storage: uploads photo to the existing 'job-photos' bucket
// DB: writes to receipts_master with source='dashboard'

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type UploadReceiptResult =
  | { ok: true; receipt_id: number; photo_url: string }
  | { ok: false; error: string };

export async function uploadReceipt(formData: FormData): Promise<UploadReceiptResult> {
  const me = await getCurrentTech();
  if (!me?.canWrite) return { ok: false, error: "Not signed in or no write access." };

  const photo = formData.get("photo") as File | null;
  const invoiceNumber = (formData.get("invoice_number") as string | null)?.trim() || null;
  const amountStr = (formData.get("amount") as string | null)?.trim() || null;
  const vendor = (formData.get("vendor") as string | null)?.trim() || null;
  const notes = (formData.get("notes") as string | null)?.trim() || null;

  if (!photo || photo.size === 0) {
    return { ok: false, error: "Photo is required." };
  }

  const amount = amountStr ? Number(amountStr.replace(/[^0-9.-]/g, "")) : null;
  if (amountStr && (!Number.isFinite(amount) || amount! < 0)) {
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

  const today = new Date().toISOString().slice(0, 10);
  const { data: row, error: insErr } = await supabase
    .from("receipts_master")
    .insert({
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
    return { ok: false, error: insErr?.message ?? "Insert failed" };
  }

  revalidatePath("/receipt");
  return { ok: true, receipt_id: row.id as number, photo_url: publicUrl.publicUrl };
}
