"use server";

// Forward-to-attach queue. Leadership (admin/manager) forward a client email to
// ddunlop+attach@tulsapar.com; it lands in emails_received via the existing
// pull-gmail ingest. The queue = those forwarded emails not yet pinned and not
// dismissed. Attaching reuses email_pins (the same store the owner's curated
// pins use), so attached emails surface on the customer/job pages + Job Briefing
// through the existing viewer-scoped display.
//
// GATING NOTE: these actions allow admin OR manager. Managers are read-only
// elsewhere (requireWriter blocks them), but Danny explicitly wants Kelsey/
// Madisson to attach client emails (2026-05-29). The action is additive and
// audited — pinned_by / dismissed_by record the actor.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type Visibility = "leadership" | "tech";

const ATTACH_ADDRESS = "ddunlop+attach@tulsapar.com";

export type QueueEmail = {
  emailId: string;
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  aiSummary: string | null;
  receivedAt: string | null;
};

export type CustomerOption = { id: string; name: string | null; email: string | null };
export type JobOption = { id: string; label: string };

async function requireLeadership(): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return { ok: false, error: "not signed in" };
  if (me.isAdmin || me.isManager) return { ok: true, email: me.realEmail || me.email };
  return { ok: false, error: "Only leadership can attach emails." };
}

export async function listAttachQueue(): Promise<QueueEmail[]> {
  const gate = await requireLeadership();
  if (!gate.ok) return [];
  const supa = db();

  const { data } = await supa
    .from("emails_received")
    .select("id, from_address, from_name, subject, snippet, ai_summary, received_at")
    .or(`to_addresses.cs.{"${ATTACH_ADDRESS}"},cc_addresses.cs.{"${ATTACH_ADDRESS}"}`)
    .order("received_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as Array<{
    id: string; from_address: string | null; from_name: string | null;
    subject: string | null; snippet: string | null; ai_summary: string | null; received_at: string | null;
  }>;
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [pinsRes, disRes] = await Promise.all([
    supa.from("email_pins").select("email_id").in("email_id", ids),
    supa.from("email_attach_dismissals").select("email_id").in("email_id", ids),
  ]);
  const done = new Set<string>([
    ...((pinsRes.data ?? []) as Array<{ email_id: string }>).map((p) => String(p.email_id)),
    ...((disRes.data ?? []) as Array<{ email_id: string }>).map((d) => String(d.email_id)),
  ]);

  return rows
    .filter((r) => !done.has(r.id))
    .map((r) => ({
      emailId: r.id,
      fromAddress: r.from_address,
      fromName: r.from_name,
      subject: r.subject,
      snippet: r.snippet,
      aiSummary: r.ai_summary,
      receivedAt: r.received_at,
    }));
}

export async function searchCustomers(query: string): Promise<CustomerOption[]> {
  const gate = await requireLeadership();
  if (!gate.ok) return [];
  const q = (query ?? "").replace(/[,()"]/g, " ").trim();
  if (q.length < 2) return [];
  const { data } = await db()
    .from("customers_master")
    .select("hcp_customer_id, name, email")
    .or(`name.ilike.%${q}%,email.ilike.%${q}%,last_name.ilike.%${q}%`)
    .limit(12);
  return ((data ?? []) as Array<{ hcp_customer_id: string; name: string | null; email: string | null }>).map((c) => ({
    id: c.hcp_customer_id,
    name: c.name,
    email: c.email,
  }));
}

export async function listJobsForCustomer(hcpCustomerId: string): Promise<JobOption[]> {
  const gate = await requireLeadership();
  if (!gate.ok) return [];
  const { data } = await db()
    .from("job_360")
    .select("hcp_job_id, job_date")
    .eq("hcp_customer_id", hcpCustomerId)
    .order("job_date", { ascending: false })
    .limit(30);
  return ((data ?? []) as Array<{ hcp_job_id: string; job_date: string | null }>).map((j) => ({
    id: j.hcp_job_id,
    label: `${j.job_date ?? "—"} · ${j.hcp_job_id.slice(0, 8)}`,
  }));
}

export async function attachFromQueue(input: {
  emailId: string; hcpCustomerId: string; hcpJobId?: string | null; visibility: Visibility; handlingNote?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireLeadership();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { error } = await db().from("email_pins").upsert({
    email_id: input.emailId,
    hcp_customer_id: input.hcpCustomerId,
    hcp_job_id: input.hcpJobId ?? null,
    visibility: input.visibility,
    handling_note: input.handlingNote?.trim() || null,
    pinned_by: gate.email,
    updated_at: new Date().toISOString(),
  }, { onConflict: "email_id,hcp_customer_id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/attach");
  revalidatePath(`/customer/${input.hcpCustomerId}`);
  return { ok: true };
}

export async function dismissQueued(emailId: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireLeadership();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { error } = await db().from("email_attach_dismissals").upsert({
    email_id: emailId,
    dismissed_by: gate.email,
    dismissed_at: new Date().toISOString(),
  }, { onConflict: "email_id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/attach");
  return { ok: true };
}
