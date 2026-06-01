"use server";

// Log a material receipt against a job from the dashboard (Madisson meeting #11).
// Receipts attach to a job by INVOICE TRUNK (split_part(invoice_number,'-',1)),
// so a dashboard receipt flows into job_cost_v1/v2 exactly like a Slack /receipt
// — no hcp_job_id FK on receipts_master. We store the job's invoice number.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

// Mon–Sun week containing `now` (receipts_master requires week_label/start/end).
function weekBounds(now: Date): { label: string; start: string; end: string } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMon = (d.getUTCDay() + 6) % 7;
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - sinceMon);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { label: iso(mon), start: iso(mon), end: iso(sun) };
}

export async function logReceipt(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getCurrentTech();
  if (!me || !me.canWrite) return { ok: false, error: "not authorized" };

  const invoice = String(formData.get("invoice_number") ?? "").trim();
  const jobId = String(formData.get("job_id") ?? "").trim();
  if (!invoice) return { ok: false, error: "this job has no invoice number to attach a receipt to" };

  const amount = Number(formData.get("amount") ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "enter a valid amount" };
  const vendor = String(formData.get("vendor_description") ?? "").trim().slice(0, 300) || "(unspecified)";

  const now = new Date();
  const wk = weekBounds(now);
  const { error } = await db().from("receipts_master").insert({
    week_label: wk.label,
    week_start: wk.start,
    week_end: wk.end,
    source: "dashboard",
    transaction_date: now.toISOString().slice(0, 10),
    amount,
    vendor_description: vendor,
    invoice_number: invoice,
    is_overhead: false,
    has_paper_receipt: false,
    source_file: `dashboard:job/${jobId || invoice}`,
    source_row_index: 0,
    source_section: "dashboard-job-page",
    tech_name: me.tech?.tech_short_name ?? me.email,
  });
  if (error) return { ok: false, error: error.message };
  if (jobId) revalidatePath(`/job/${jobId}`);
  return { ok: true };
}
