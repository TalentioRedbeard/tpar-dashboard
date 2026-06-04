"use server";

// CRUD for the /contacts business directory (tpar_contacts). Add/edit the
// vendors, subs, utilities, agencies, and suppliers the field calls + texts.
// The read-only directory shipped first (2026-05-19); this is the follow-up
// "add/edit" slice it was waiting for (Danny 2026-06-04, Slice 2).
//
// Gated to admin + manager: the directory is shared business data, so curation
// stays with leadership (techs request additions via /ask → knowledge_gaps).
// Sending TO a contact stays open to any writer (see /comms/new).

import { revalidatePath } from "next/cache";
import { db } from "../../lib/supabase";
import { getCurrentTech } from "../../lib/current-tech";

const VALID_KINDS = [
  "vendor", "subcontractor", "utility", "agency",
  "emergency", "pricing_source", "supply", "competitor", "other",
];
const VALID_STATUS = ["active", "inactive", "research_candidate"];

export type ContactUpsertResult = { ok: true; id: string } | { ok: false; error: string };

async function requireContactEditor(): Promise<{ email: string } | { error: string }> {
  const me = await getCurrentTech();
  if (!me) return { error: "not signed in" };
  if (!me.isAdmin && !me.isManager) return { error: "not authorized — admin or manager only" };
  return { email: me.email };
}

function toE164(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (s.startsWith("+") && digits.length >= 11) return `+${digits}`;
  return null;
}

export async function upsertContact(_prev: ContactUpsertResult, formData: FormData): Promise<ContactUpsertResult> {
  const gate = await requireContactEditor();
  if ("error" in gate) return { ok: false, error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const altPhone = String(formData.get("alt_phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const website = String(formData.get("website") ?? "").trim();
  const whenToCall = String(formData.get("when_to_call") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const tagsRaw = String(formData.get("category_tags") ?? "").trim();
  const status = String(formData.get("status") ?? "active").trim();
  const isPreferred = formData.get("is_preferred") === "on";

  if (!name) return { ok: false, error: "name is required" };
  if (!VALID_KINDS.includes(kind)) return { ok: false, error: `pick a contact type` };
  if (!VALID_STATUS.includes(status)) return { ok: false, error: `invalid status: ${status}` };

  let phone_e164: string | null = null;
  if (phoneRaw) {
    phone_e164 = toE164(phoneRaw);
    if (!phone_e164) return { ok: false, error: `phone must be 10 digits or E.164: "${phoneRaw}"` };
  }

  const category_tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];

  const supa = db();
  const row = {
    name,
    kind,
    phone_e164,
    alt_phone: altPhone || null,
    email: email || null,
    website: website || null,
    when_to_call: whenToCall || null,
    notes: notes || null,
    category_tags,
    status,
    is_preferred: isPreferred,
    is_competitor: kind === "competitor", // keep the flag the /contacts badge reads in sync with kind
    updated_by_email: gate.email,
  };

  if (id) {
    const { error } = await supa.from("tpar_contacts").update(row).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/contacts");
    return { ok: true, id };
  }

  const { data, error } = await supa
    .from("tpar_contacts")
    .insert({ ...row, created_by_email: gate.email })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contacts");
  return { ok: true, id: (data?.id as string) ?? "" };
}
