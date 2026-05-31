"use server";

// Phase 3 of the dispatch redesign (Danny 2026-05-30): customer-level context
// reports. "Request a report" calls the generate-customer-report edge fn; the
// result is saved to customer_reports, editable, and surfaced in customer-360.
// Leadership-only (admin || manager).

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type CustomerReport = {
  id: string;
  hcp_customer_id: string;
  customer_name: string | null;
  title: string | null;
  body_md: string;
  status: string;
  generated_by: string;
  model: string | null;
  requested_by: string | null;
  edited_by: string | null;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReportResult = { ok: true; report: CustomerReport } | { ok: false; error: string };

async function requireLeadership(): Promise<{ email: string } | { error: string }> {
  const me = await getCurrentTech();
  if (!me) return { error: "not signed in" };
  if (!(me.isAdmin || me.isManager)) return { error: "leadership only (admin or manager)" };
  return { email: me.email };
}

export async function requestCustomerReport(hcpCustomerId: string): Promise<ReportResult> {
  const gate = await requireLeadership();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!SERVICE_KEY) return { ok: false, error: "server misconfigured — service key missing" };
  const id = hcpCustomerId.trim();
  if (!id) return { ok: false, error: "missing customer id" };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-customer-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ hcp_customer_id: id, requested_by: gate.email }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) return { ok: false, error: json?.error ?? `generate-customer-report ${res.status}` };
    const supa = db();
    const { data } = await supa.from("customer_reports").select("*").eq("id", json.report_id).maybeSingle();
    if (!data) return { ok: false, error: "report generated but could not be loaded" };
    revalidatePath(`/customer/${id}`);
    return { ok: true, report: data as CustomerReport };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveCustomerReport(input: { id: string; title: string; body_md: string; status?: string }): Promise<ReportResult> {
  const gate = await requireLeadership();
  if ("error" in gate) return { ok: false, error: gate.error };
  const supa = db();
  const now = new Date().toISOString();
  const { data, error } = await supa
    .from("customer_reports")
    .update({
      title: input.title.slice(0, 200),
      body_md: input.body_md.slice(0, 20000),
      status: input.status === "final" ? "final" : "draft",
      edited_by: gate.email,
      edited_at: now,
      updated_at: now,
    })
    .eq("id", input.id)
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "save failed" };
  const report = data as CustomerReport;
  revalidatePath(`/customer/${report.hcp_customer_id}`);
  return { ok: true, report };
}
