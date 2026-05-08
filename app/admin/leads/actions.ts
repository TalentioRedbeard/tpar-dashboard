"use server";

// /admin/leads — server actions.
//
// Surfaces communication_events flagged `new_lead` (classifier upgrade
// 2026-05-05) AND emails_received flagged `new_lead` (Gmail ingest with
// estimate-request from non-customer, 2026-05-08) sorted by importance +
// recency. Uses acked_at / acked_by columns to track "handled" — same
// shape across both sources.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type Lead = {
  kind: "event" | "email";        // discriminator — events have number ids, emails have uuid strings
  id: string;                      // string for both (events stringified; emails are uuids)
  occurred_at: string;
  channel: string;                 // 'call' | 'text' | 'email' | etc.
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
  // Email-specific (null for events)
  email_from_address?: string | null;
  email_subject?: string | null;
  // Extracted contact info from the body
  extracted_phones: string[];
  extracted_emails: string[];
  is_paid: boolean;
};

function extractContacts(body: string | null): { phones: string[]; emails: string[] } {
  if (!body) return { phones: [], emails: [] };
  const emails = Array.from(
    new Set((body.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []).map((e) => e.toLowerCase())),
  );
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

function annotateEvent(r: Record<string, unknown>): Lead {
  const c = extractContacts((r.content_text as string | null) ?? null);
  const flags = Array.isArray(r.flags) ? (r.flags as string[]) : [];
  return {
    kind: "event",
    id: String(r.id),
    occurred_at: String(r.occurred_at),
    channel: String(r.channel ?? ""),
    importance: Number(r.importance ?? 0),
    flags,
    customer_name: r.customer_name == null ? null : String(r.customer_name),
    summary: r.summary == null ? null : String(r.summary),
    content_text: r.content_text == null ? null : String(r.content_text),
    hcp_customer_id: r.hcp_customer_id == null ? null : String(r.hcp_customer_id),
    hcp_job_id: r.hcp_job_id == null ? null : String(r.hcp_job_id),
    source_table: r.source_table == null ? null : String(r.source_table),
    source_id: r.source_id == null ? null : Number(r.source_id),
    acked_at: r.acked_at == null ? null : String(r.acked_at),
    acked_by: r.acked_by == null ? null : String(r.acked_by),
    extracted_phones: c.phones,
    extracted_emails: c.emails,
    is_paid: flags.includes("paid_acquisition"),
  };
}

function annotateEmail(r: Record<string, unknown>): Lead {
  const body = (r.body_text as string | null) ?? null;
  const c = extractContacts(body);
  const flags = Array.isArray(r.ai_flags) ? (r.ai_flags as string[]) : [];
  const fromAddr = r.from_address == null ? null : String(r.from_address);
  // Make sure the sender's own email is in the contacts list.
  const emailsSet = new Set(c.emails);
  if (fromAddr) emailsSet.add(fromAddr.toLowerCase());
  return {
    kind: "email",
    id: String(r.id),
    occurred_at: String(r.received_at),
    channel: "email",
    importance: Number(r.ai_importance ?? 0),
    flags,
    customer_name: (r.from_name ? String(r.from_name) : null) ?? fromAddr,
    summary: r.ai_summary == null ? null : String(r.ai_summary),
    content_text: body,
    hcp_customer_id: null,    // by definition a new lead = no existing customer
    hcp_job_id: null,
    source_table: "emails_received",
    source_id: null,
    acked_at: r.acked_at == null ? null : String(r.acked_at),
    acked_by: r.acked_by == null ? null : String(r.acked_by),
    email_from_address: fromAddr,
    email_subject: r.subject == null ? null : String(r.subject),
    extracted_phones: c.phones,
    extracted_emails: Array.from(emailsSet),
    is_paid: flags.includes("paid_acquisition"),
  };
}

export async function listOpenLeads(): Promise<Lead[]> {
  const me = await getCurrentTech();
  if (!me?.isAdmin && !me?.isManager) return [];
  const supa = db();

  const [eventsRes, emailsRes] = await Promise.all([
    supa.from("communication_events")
      .select("id, occurred_at, channel, importance, flags, customer_name, summary, content_text, hcp_customer_id, hcp_job_id, source_table, source_id, acked_at, acked_by")
      .contains("flags", ["new_lead"])
      .is("acked_at", null)
      .order("importance", { ascending: false })
      .order("occurred_at", { ascending: false })
      .limit(200),
    supa.from("emails_received")
      .select("id, received_at, from_address, from_name, subject, body_text, ai_summary, ai_importance, ai_flags, acked_at, acked_by")
      .contains("ai_flags", ["new_lead"])
      .is("acked_at", null)
      .order("ai_importance", { ascending: false, nullsFirst: false })
      .order("received_at", { ascending: false })
      .limit(200),
  ]);

  const events = (eventsRes.data ?? []).map((r: Record<string, unknown>) => annotateEvent(r));
  const emails = (emailsRes.data ?? []).map((r: Record<string, unknown>) => annotateEmail(r));

  // Merge + sort: importance DESC, then occurred_at DESC.
  return [...events, ...emails].sort((a, b) => {
    if (b.importance !== a.importance) return b.importance - a.importance;
    return new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
  });
}

export async function listHandledLeads(limit = 25): Promise<Lead[]> {
  const me = await getCurrentTech();
  if (!me?.isAdmin && !me?.isManager) return [];
  const supa = db();

  const [eventsRes, emailsRes] = await Promise.all([
    supa.from("communication_events")
      .select("id, occurred_at, channel, importance, flags, customer_name, summary, content_text, hcp_customer_id, hcp_job_id, source_table, source_id, acked_at, acked_by")
      .contains("flags", ["new_lead"])
      .not("acked_at", "is", null)
      .order("acked_at", { ascending: false })
      .limit(limit),
    supa.from("emails_received")
      .select("id, received_at, from_address, from_name, subject, body_text, ai_summary, ai_importance, ai_flags, acked_at, acked_by")
      .contains("ai_flags", ["new_lead"])
      .not("acked_at", "is", null)
      .order("acked_at", { ascending: false })
      .limit(limit),
  ]);

  const events = (eventsRes.data ?? []).map((r: Record<string, unknown>) => annotateEvent(r));
  const emails = (emailsRes.data ?? []).map((r: Record<string, unknown>) => annotateEmail(r));

  return [...events, ...emails]
    .sort((a, b) => {
      const aT = a.acked_at ? new Date(a.acked_at).getTime() : 0;
      const bT = b.acked_at ? new Date(b.acked_at).getTime() : 0;
      return bT - aT;
    })
    .slice(0, limit);
}

export async function markLeadHandled(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech();
  if (!me?.isAdmin && !me?.isManager) return { ok: false, error: "leadership only" };
  const id = (formData.get("id") as string | null)?.trim();
  const kind = ((formData.get("kind") as string | null) ?? "event").trim();
  if (!id) return { ok: false, error: "missing id" };
  if (!["event", "email"].includes(kind)) return { ok: false, error: "bad kind" };

  const supa = db();
  const table = kind === "email" ? "emails_received" : "communication_events";
  // communication_events.id is a number; emails_received.id is uuid. Cast accordingly.
  const idVal: string | number = kind === "email" ? id : (Number.isFinite(parseInt(id, 10)) ? parseInt(id, 10) : id);

  const { error } = await supa
    .from(table)
    .update({
      acked_at: new Date().toISOString(),
      acked_by: me.email ?? "unknown",
    })
    .eq("id", idVal);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/leads");
  return { ok: true };
}

export async function reopenLead(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech();
  if (!me?.isAdmin && !me?.isManager) return { ok: false, error: "leadership only" };
  const id = (formData.get("id") as string | null)?.trim();
  const kind = ((formData.get("kind") as string | null) ?? "event").trim();
  if (!id) return { ok: false, error: "missing id" };
  if (!["event", "email"].includes(kind)) return { ok: false, error: "bad kind" };

  const supa = db();
  const table = kind === "email" ? "emails_received" : "communication_events";
  const idVal: string | number = kind === "email" ? id : (Number.isFinite(parseInt(id, 10)) ? parseInt(id, 10) : id);

  const { error } = await supa
    .from(table)
    .update({ acked_at: null, acked_by: null })
    .eq("id", idVal);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/leads");
  return { ok: true };
}
