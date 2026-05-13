"use server";

// Admin actions for the lifecycle-mirrors page: retry a missed mirror,
// or mark it resolved (with an audit-log entry).

import { db } from "@/lib/supabase";
import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { revalidatePath } from "next/cache";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type RetryResult = { ok: true; request_id?: string } | { ok: false; error: string };
export type ResolveResult = { ok: true } | { ok: false; error: string };

export async function retryHcpMirror(input: { hcp_job_id: string; action: string }): Promise<RetryResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isAdmin(user.email)) return { ok: false, error: "Admin required." };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "Server config missing." };

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/hcp-trigger-action`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ job_id: input.hcp_job_id, action: input.action }),
    });
    const text = await res.text();
    let parsed: { request_id?: string; error?: string } = {};
    try { parsed = JSON.parse(text); } catch { /* */ }
    if (!res.ok && res.status !== 202) {
      return { ok: false, error: parsed.error ?? `bot returned ${res.status}` };
    }
    // Audit
    await db().from("maintenance_logs").insert({
      source: "admin-mirror-retry",
      level: "info",
      message: "Admin retried lifecycle mirror",
      context: {
        hcp_job_id: input.hcp_job_id,
        action: input.action,
        request_id: parsed.request_id,
        admin_email: user.email,
      },
    });
    revalidatePath("/admin/lifecycle-mirrors");
    return { ok: true, request_id: parsed.request_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function resolveHcpMirror(input: { event_id: string; note?: string }): Promise<ResolveResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isAdmin(user.email)) return { ok: false, error: "Admin required." };

  const { error } = await db().from("maintenance_logs").insert({
    source: "lifecycle-mirror-resolved",
    level: "info",
    message: `Admin marked mirror miss resolved: ${input.note ?? "no note"}`,
    context: {
      event_id: input.event_id,
      note: input.note ?? null,
      admin_email: user.email,
    },
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/lifecycle-mirrors");
  return { ok: true };
}
