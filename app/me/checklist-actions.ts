"use server";

// Server actions for the two field checklists (post-presentation + end-of-job),
// now native web forms on /me wired to lifecycle triggers 5 (Present) & 7 (Done).
// Replaces the old Google-Form / Slack `/ask` submission path. source='web'.
//
// Auto-fill: getJobChecklistPrefill() pulls everything we already know about
// the job (photos, estimate/options, invoice line items = materials, customer
// lead source, membership status) so the tech confirms rather than re-types.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type ChecklistResult = { ok: true } | { ok: false; error: string };

export type ChecklistPrefill = {
  post: {
    beforePhotoTaken: boolean | null;
    photoCount: number;
    optionsProvided: boolean | null;
    optionsHint: string | null;
  };
  eoj: {
    materialsDescription: string;
    howClientHeard: string;
    isMember: boolean;
    membershipName: string | null;
  };
};

const EMPTY_PREFILL: ChecklistPrefill = {
  post: { beforePhotoTaken: null, photoCount: 0, optionsProvided: null, optionsHint: null },
  eoj: { materialsDescription: "", howClientHeard: "", isMember: false, membershipName: null },
};

/** Pull every known/knowable field for a job so the checklists arrive pre-filled. */
export async function getJobChecklistPrefill(hcpJobId: string): Promise<ChecklistPrefill> {
  if (!hcpJobId) return EMPTY_PREFILL;
  const supa = db();

  const [j360, linesRes] = await Promise.all([
    supa.from("job_360")
      .select("hcp_customer_id, photo_count, hcp_estimate_number, bid_estimate_count")
      .eq("hcp_job_id", hcpJobId).maybeSingle(),
    supa.from("hcp_invoice_line_items_v")
      .select("line_item_name, line_item_type")
      .eq("hcp_job_id", hcpJobId).limit(50),
  ]);

  const cust = (j360.data?.hcp_customer_id as string | null) ?? null;
  const photoCount = Number(j360.data?.photo_count ?? 0);
  const estNum = (j360.data?.hcp_estimate_number as string | null) ?? null;
  const bidCount = Number(j360.data?.bid_estimate_count ?? 0);

  // Materials = parts/material lines (drop labor, discounts, fees, trip charges).
  const matNames = ((linesRes.data ?? []) as Array<{ line_item_name: string | null; line_item_type: string | null }>)
    .filter((l) => l.line_item_name &&
      !/labor|discount|fee|trip|service call|membership/i.test(`${l.line_item_type ?? ""} ${l.line_item_name}`))
    .map((l) => (l.line_item_name as string).trim());
  const materialsDescription = [...new Set(matNames)].join(", ");

  let howClientHeard = "";
  let isMember = false;
  let membershipName: string | null = null;
  if (cust) {
    const [leadRes, memRes] = await Promise.all([
      supa.from("hcp_customers_raw").select("lead_source").eq("hcp_customer_id", cust).maybeSingle(),
      supa.from("customer_membership_status_v").select("status, customer_facing_name").eq("hcp_customer_id", cust).maybeSingle(),
    ]);
    howClientHeard = (leadRes.data?.lead_source as string | null) ?? "";
    if ((memRes.data?.status as string | null) === "active") {
      isMember = true;
      membershipName = (memRes.data?.customer_facing_name as string | null) ?? "Member";
    }
  }

  return {
    post: {
      beforePhotoTaken: photoCount > 0 ? true : null,
      photoCount,
      optionsProvided: estNum || bidCount > 0 ? true : null,
      optionsHint: estNum ? `Estimate #${estNum}` : bidCount > 0 ? `${bidCount} option(s) on file` : null,
    },
    eoj: { materialsDescription, howClientHeard, isMember, membershipName },
  };
}

export async function submitPostPresentationChecklist(input: {
  hcp_job_id: string;
  before_photo_taken: boolean | null;
  options_provided: boolean | null;
  options_notes?: string | null;
  appointment_result?: string | null;
  other_description?: string | null;
}): Promise<ChecklistResult> {
  const me = await getCurrentTech();
  if (!me?.tech) return { ok: false, error: "Not signed in as a tech." };
  if (!input.hcp_job_id) return { ok: false, error: "Missing job." };

  const allowed = new Set(["performing", "scheduling", "estimate", "service_fee", "other", "no_answer"]);
  const result = input.appointment_result && allowed.has(input.appointment_result) ? input.appointment_result : null;

  const { error } = await db().from("checklist_post_presentation").insert({
    hcp_job_id: input.hcp_job_id,
    tech_name: me.tech.tech_short_name,
    technician_email: me.tech.email ?? me.email ?? null,
    before_photo_taken: input.before_photo_taken,
    options_provided: input.options_provided,
    options_notes: input.options_notes?.trim() || null,
    appointment_result: result,
    other_description: input.other_description?.trim() || null,
    source: "web",
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/me");
  revalidatePath(`/job/${input.hcp_job_id}`);
  return { ok: true };
}

export async function submitEndOfJobChecklist(input: {
  hcp_job_id: string;
  obtained_work_approval: boolean | null;
  materials_description?: string | null;
  office_update?: "on_time" | "late" | "no" | null;
  client_debriefed: boolean | null;
  membership_discussed: boolean | null;
  member_interested: boolean | null;
  maintenance_discussed: boolean | null;
  review_requested: boolean | null;
  how_client_heard?: string | null;
  management_notes?: string | null;
}): Promise<ChecklistResult> {
  const me = await getCurrentTech();
  if (!me?.tech) return { ok: false, error: "Not signed in as a tech." };
  if (!input.hcp_job_id) return { ok: false, error: "Missing job." };

  const office = input.office_update ?? null;
  const { error } = await db().from("checklist_end_of_job").insert({
    hcp_job_id: input.hcp_job_id,
    tech_name: me.tech.tech_short_name,
    technician_email: me.tech.email ?? me.email ?? null,
    obtained_work_approval: input.obtained_work_approval,
    materials_description: input.materials_description?.trim() || null,
    updated_office_on_time: office ? office === "on_time" : null,
    updated_office_late: office ? office === "late" : null,
    client_debriefed: input.client_debriefed,
    membership_discussed: input.membership_discussed,
    member_interested: input.member_interested,
    maintenance_discussed: input.maintenance_discussed,
    review_requested: input.review_requested,
    how_client_heard: input.how_client_heard?.trim() || null,
    management_notes: input.management_notes?.trim() || null,
    source: "web",
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/me");
  revalidatePath(`/job/${input.hcp_job_id}`);
  return { ok: true };
}
