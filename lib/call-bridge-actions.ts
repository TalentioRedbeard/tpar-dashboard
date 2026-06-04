"use server";

// Click-to-call bridge (Slice 3). Rings the signed-in operator's phone first,
// then call-bridge dials the contact with the TPAR business caller ID. Any
// writer may originate (same gate as /comms/new). The operator's own number is
// resolved server-side from tech_directory — never trusted from the client.

import { db } from "./supabase";
import { getCurrentTech } from "./current-tech";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type CallBridgeResult = { ok: true; call_sid: string } | { ok: false; error: string };

function toE164(raw: string): string | null {
  const s = String(raw ?? "").trim();
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (s.startsWith("+") && d.length >= 11) return `+${d}`;
  return null;
}

export async function startCallBridge(input: {
  contactPhone: string;
  contactName?: string;
  contactKind?: string;
  hcpCustomerId?: string;
  hcpJobId?: string;
}): Promise<CallBridgeResult> {
  const me = await getCurrentTech();
  if (!me) return { ok: false, error: "not signed in" };
  if (!me.isAdmin && me.dashboardRole !== "tech" && !me.isManager) return { ok: false, error: "not authorized" };
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, error: "server config missing" };

  const contact = toE164(input.contactPhone);
  if (!contact) return { ok: false, error: "invalid contact number" };

  // The operator's own phone (rings first). Resolve from tech_directory by email.
  const { data: techRow } = await db()
    .from("tech_directory")
    .select("phone, tech_short_name")
    .ilike("email", me.email.toLowerCase())
    .maybeSingle();
  const operatorPhone = toE164((techRow?.phone as string | null) ?? "");
  if (!operatorPhone) {
    return { ok: false, error: "Add your mobile number to your tech profile first — the bridge rings your phone, then the contact." };
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/call-bridge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({
      operator_phone: operatorPhone,
      operator_email: me.email,
      operator_short_name: (techRow?.tech_short_name as string | null) ?? me.tech?.tech_short_name ?? me.email.split("@")[0],
      contact_phone: contact,
      contact_name: input.contactName ?? null,
      contact_kind: input.contactKind ?? null,
      hcp_customer_id: input.hcpCustomerId ?? null,
      hcp_job_id: input.hcpJobId ?? null,
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; call_sid?: string; error?: string };
  if (!res.ok || !j.ok) return { ok: false, error: j.error ?? `call-bridge ${res.status}` };
  return { ok: true, call_sid: j.call_sid ?? "" };
}
