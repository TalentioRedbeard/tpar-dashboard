"use server";

// /admin/leads — server actions.
//
// Surfaces communication_events flagged `new_lead` (the classifier upgrade
// landed 2026-05-05) sorted by importance + recency. Uses the existing
// acked_at / acked_by columns to track "handled" — no new schema.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type Lead = {
  id: number;
  occurred_at: string;
  channel: string;
  importance: number;
  flags: string[];
  customer_name: string | null;
  summary: string | null;
  content_text: string | null;
  hcp_customer_id: string | null;
  hcp_job_id: string | null;
  source_table: string | null;
  source_id: number | null;
  acked_at: string | null;
  acked_by: string | null;
  // Extracted contact info from the body
  extracted_phones: string[];
  extracted_emails: string[];
  is_paid: boolean;
};

// Pull phone numbers + email addresses out of the message body. Not perfect —
// good enough for one-tap call/email next to each lead.
function extractContacts(body: string | null): { phones: string[]; emails: string[] } {
  if (!body) return { phones: [], emails: [] };
  const emails = Array.from(
    new Set((body.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []).map((e) => e.toLowerCase())),
  );
  // Phones: match common US shapes — (xxx) xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, xxxxxxxxxx
  const raw = body.match(/(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g) ?? [];
  const phones = Array.from(
    new Set(
      raw
        .map((p) => p.replace(/\D/g, ""))
        .map((d) => (d.length === 11 && d.startsWith("1") ? d.slice(1) : d))
        .filter((d) => d.length === 10),
    ),
  );
  return { phones, emails };
}

function annotate(rows: Array<Omit<Lead, "extracted_phones" | "extracted_emails" | "is_paid">>): Lead[] {
  return rows.map((r) => {
    const c = extractContacts(r.content_text);
    return {
      ...r,
      extracted_phones: c.phones,
      extracted_emails: c.emails,
      is_paid: (r.flags ?? []).includes("paid_acquisition"),
    };
  });
}

export async function listOpenLeads(): Promise<Lead[]> {
  const me = await getCurrentTech();
  if (!me?.isAdmin && !me?.isManager) return [];
  const supa = db();
  const { data } = await supa
    .from("communication_events")
    .select("id, occurred_at, channel, importance, flags, customer_name, summary, content_text, hcp_customer_id, hcp_job_id, source_table, source_id, acked_at, acked_by")
    .contains("flags", ["new_lead"])
    .is("acked_at", null)
    .order("importance", { ascending: false })
    .order("occurred_at", { ascending: false })
    .limit(200);
  return annotate((data ?? []) as any);
}

export async function listHandledLeads(limit = 25): Promise<Lead[]> {
  const me = await getCurrentTech();
  if (!me?.isAdmin && !me?.isManager) return [];
  const supa = db();
  const { data } = await supa
    .from("communication_events")
    .select("id, occurred_at, channel, importance, flags, customer_name, summary, content_text, hcp_customer_id, hcp_job_id, source_table, source_id, acked_at, acked_by")
    .contains("flags", ["new_lead"])
    .not("acked_at", "is", null)
    .order("acked_at", { ascending: false })
    .limit(limit);
  return annotate((data ?? []) as any);
}

export async function markLeadHandled(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech();
  if (!me?.isAdmin && !me?.isManager) return { ok: false, error: "leadership only" };
  const idStr = (formData.get("id") as string | null)?.trim();
  if (!idStr) return { ok: false, error: "missing id" };
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) return { ok: false, error: "bad id" };
  const supa = db();
  const { error } = await supa
    .from("communication_events")
    .update({
      acked_at: new Date().toISOString(),
      acked_by: me.email ?? "unknown",
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/leads");
  return { ok: true };
}

export async function reopenLead(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech();
  if (!me?.isAdmin && !me?.isManager) return { ok: false, error: "leadership only" };
  const idStr = (formData.get("id") as string | null)?.trim();
  if (!idStr) return { ok: false, error: "missing id" };
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) return { ok: false, error: "bad id" };
  const supa = db();
  const { error } = await supa
    .from("communication_events")
    .update({ acked_at: null, acked_by: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/leads");
  return { ok: true };
}
