"use server";

// Curated inbox-email attach for a customer. The owner browses emails from
// their Gmail inbox (emails_received) matched to the customer, and pins the
// relevant ones with a visibility level + a "handling note". Pinned emails
// surface on the customer/job pages per their visibility; the raw browse/search
// is owner-only.

import { db } from "@/lib/supabase";
import { getCurrentTech, requireOwner } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type Visibility = "leadership" | "tech";

export type InboxMatch = {
  emailId: string;
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  aiSummary: string | null;
  receivedAt: string;
  alreadyPinned: boolean;
};

export type PinnedEmail = {
  pinId: string;
  emailId: string;
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  aiSummary: string | null;
  snippet: string | null;
  receivedAt: string | null;
  visibility: Visibility;
  handlingNote: string | null;
  hcpJobId: string | null;
};

type EmailRow = {
  id: string;
  from_address: string | null;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  ai_summary: string | null;
  received_at: string | null;
};

// Owner-only: emails from the owner's inbox related to this customer. With no
// query, match by the customer's email across from/to/cc; with a query, search
// the inbox (subject/sender/snippet) so indirect threads can be found too.
export async function listInboxMatches(hcpCustomerId: string, query?: string): Promise<InboxMatch[]> {
  const owner = await requireOwner();
  if (!owner.ok) return [];
  const supa = db();

  const q = (query ?? "").replace(/[,()"]/g, " ").trim();
  let ors: string[] = [];
  if (q) {
    ors = [`subject.ilike.%${q}%`, `from_address.ilike.%${q}%`, `from_name.ilike.%${q}%`, `snippet.ilike.%${q}%`];
  } else {
    const { data: cust } = await supa.from("customers_master").select("email").eq("hcp_customer_id", hcpCustomerId).maybeSingle();
    const email = (cust?.email as string | null)?.trim();
    if (!email) return [];
    ors = [`from_address.ilike.${email}`, `to_addresses.cs.{"${email}"}`, `cc_addresses.cs.{"${email}"}`];
  }

  const { data } = await supa
    .from("emails_received")
    .select("id, from_address, from_name, subject, snippet, ai_summary, received_at")
    .or(ors.join(","))
    .order("received_at", { ascending: false })
    .limit(40);
  const rows = (data ?? []) as EmailRow[];
  if (rows.length === 0) return [];

  const { data: pins } = await supa
    .from("email_pins")
    .select("email_id")
    .eq("hcp_customer_id", hcpCustomerId)
    .in("email_id", rows.map((r) => r.id));
  const pinned = new Set((pins ?? []).map((p) => String((p as { email_id: string }).email_id)));

  return rows.map((r) => ({
    emailId: r.id,
    fromAddress: r.from_address,
    fromName: r.from_name,
    subject: r.subject,
    snippet: r.snippet,
    aiSummary: r.ai_summary,
    receivedAt: r.received_at ?? "",
    alreadyPinned: pinned.has(r.id),
  }));
}

// Pinned emails for a customer, scoped to the viewer: leadership sees all;
// a tech sees only pins explicitly shared with techs ('tech' visibility).
export async function listPinnedEmails(hcpCustomerId: string): Promise<PinnedEmail[]> {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return [];
  const leadership = me.isAdmin || me.isManager;

  let qb = db()
    .from("email_pins")
    .select("id, email_id, hcp_job_id, visibility, handling_note, pinned_at, emails_received(from_address, from_name, subject, ai_summary, snippet, received_at)")
    .eq("hcp_customer_id", hcpCustomerId)
    .order("pinned_at", { ascending: false });
  if (!leadership) qb = qb.eq("visibility", "tech");

  const { data } = await qb;
  return ((data ?? []) as unknown as Array<{
    id: string; email_id: string; hcp_job_id: string | null; visibility: Visibility; handling_note: string | null;
    emails_received: EmailRow | null;
  }>).map((p) => ({
    pinId: p.id,
    emailId: p.email_id,
    fromAddress: p.emails_received?.from_address ?? null,
    fromName: p.emails_received?.from_name ?? null,
    subject: p.emails_received?.subject ?? null,
    aiSummary: p.emails_received?.ai_summary ?? null,
    snippet: p.emails_received?.snippet ?? null,
    receivedAt: p.emails_received?.received_at ?? null,
    visibility: p.visibility,
    handlingNote: p.handling_note,
    hcpJobId: p.hcp_job_id,
  }));
}

// Pinned emails relevant to a specific job: customer-level pins (hcp_job_id
// null) + pins explicitly attached to this job. Viewer-scoped like the
// customer list. Used on the job page + to feed the Job Briefing.
export async function listPinnedEmailsForJob(hcpJobId: string, hcpCustomerId: string | null): Promise<PinnedEmail[]> {
  if (!hcpCustomerId) return [];
  const me = await getCurrentTech().catch(() => null);
  if (!me) return [];
  const leadership = me.isAdmin || me.isManager;

  let qb = db()
    .from("email_pins")
    .select("id, email_id, hcp_job_id, visibility, handling_note, pinned_at, emails_received(from_address, from_name, subject, ai_summary, snippet, received_at)")
    .eq("hcp_customer_id", hcpCustomerId)
    .or(`hcp_job_id.is.null,hcp_job_id.eq.${hcpJobId}`)
    .order("pinned_at", { ascending: false });
  if (!leadership) qb = qb.eq("visibility", "tech");

  const { data } = await qb;
  return ((data ?? []) as unknown as Array<{
    id: string; email_id: string; hcp_job_id: string | null; visibility: Visibility; handling_note: string | null;
    emails_received: EmailRow | null;
  }>).map((p) => ({
    pinId: p.id,
    emailId: p.email_id,
    fromAddress: p.emails_received?.from_address ?? null,
    fromName: p.emails_received?.from_name ?? null,
    subject: p.emails_received?.subject ?? null,
    aiSummary: p.emails_received?.ai_summary ?? null,
    snippet: p.emails_received?.snippet ?? null,
    receivedAt: p.emails_received?.received_at ?? null,
    visibility: p.visibility,
    handlingNote: p.handling_note,
    hcpJobId: p.hcp_job_id,
  }));
}

export async function pinEmail(input: {
  emailId: string; hcpCustomerId: string; hcpJobId?: string | null; visibility: Visibility; handlingNote?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };
  const { error } = await db().from("email_pins").upsert({
    email_id: input.emailId,
    hcp_customer_id: input.hcpCustomerId,
    hcp_job_id: input.hcpJobId ?? null,
    visibility: input.visibility,
    handling_note: input.handlingNote?.trim() || null,
    pinned_by: owner.email,
    updated_at: new Date().toISOString(),
  }, { onConflict: "email_id,hcp_customer_id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/customer/${input.hcpCustomerId}`);
  return { ok: true };
}

export async function updatePin(input: {
  pinId: string; hcpCustomerId: string; visibility: Visibility; handlingNote?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };
  const { error } = await db().from("email_pins")
    .update({ visibility: input.visibility, handling_note: input.handlingNote?.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", input.pinId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/customer/${input.hcpCustomerId}`);
  return { ok: true };
}

export async function unpinEmail(pinId: string, hcpCustomerId: string): Promise<{ ok: boolean }> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false };
  await db().from("email_pins").delete().eq("id", pinId);
  revalidatePath(`/customer/${hcpCustomerId}`);
  return { ok: true };
}
