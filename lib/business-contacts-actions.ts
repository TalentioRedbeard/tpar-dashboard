"use server";

// Unified business contact list for the comms composer — techs/staff, vendors,
// and distributors in one normalized list so a writer can text (or queue a call
// to) any of them without hand-typing a number. Slice 1 of the outbound-comms
// build (Danny 2026-06-04): predominantly techs / distributors / vendors.
//
// Source of truth stays in the three existing tables (no new base table):
//   - tech_directory  → techs/staff (phone is E.164; has sms_opt_out)
//   - tpar_contacts   → vendors / subs / utilities / agencies (phone_e164)
//   - distributors    → parts suppliers for the Shopping page (free-text phone)
//
// Only contacts with a usable phone are returned. tpar_contacts/distributors have
// no per-contact opt-out column yet (Slice 2); for now only techs carry opted_out.
// A future `business_contacts_v` DB view can replace this union once it's applied.

import { getCurrentTech } from "./current-tech";
import { db } from "./supabase";

export type BusinessContactSource = "tech" | "contact" | "distributor";

export type BusinessContact = {
  key: string;            // `${source}:${id}` — stable React key
  source: BusinessContactSource;
  name: string;
  subtitle: string;       // role / kind / category, for display
  phoneE164: string;      // normalized; entries without a valid phone are dropped
  recipientType: string;  // maps to the composer's recipient_type tag
  optedOut: boolean;      // tech sms_opt_out; false elsewhere (no column yet)
};

function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (s.startsWith("+") && digits.length >= 11) return `+${digits}`;
  return null;
}

// tpar_contacts.kind → the composer's recipient_type bucket.
function recipientTypeForKind(kind: string): string {
  switch (kind) {
    case "subcontractor": return "contractor";
    case "vendor":
    case "supply":
    case "pricing_source": return "vendor";
    default: return "other"; // utility, agency, emergency, competitor, other
  }
}

async function isWriter(): Promise<boolean> {
  const me = await getCurrentTech();
  if (!me) return false;
  return !!me.isAdmin || me.dashboardRole === "tech" || !!me.isManager;
}

// All textable/callable business contacts, deduped only by source key. Set is
// small (~10 techs + ~15 vendors + ~5 distributors), so we load all and let the
// composer filter client-side.
export async function loadBusinessContacts(): Promise<BusinessContact[]> {
  if (!(await isWriter())) return [];
  const supa = db();

  const [techsRes, contactsRes, distRes] = await Promise.all([
    supa
      .from("tech_directory")
      .select("hcp_employee_id, tech_short_name, hcp_full_name, phone, sms_opt_out, is_lead, is_active, is_test")
      .eq("is_active", true)
      .neq("is_test", true)
      .not("phone", "is", null),
    supa
      .from("tpar_contacts")
      .select("id, name, kind, phone_e164, status, is_preferred")
      .eq("status", "active")
      .not("phone_e164", "is", null),
    supa
      .from("distributors")
      .select("id, name, category, contact_name, phone, is_active")
      .eq("is_active", true)
      .not("phone", "is", null),
  ]);

  const out: BusinessContact[] = [];

  for (const t of (techsRes.data ?? []) as Array<Record<string, unknown>>) {
    const phone = toE164(t.phone as string | null);
    if (!phone) continue;
    const name = (t.tech_short_name as string | null)?.trim()
      || (t.hcp_full_name as string | null)?.trim()
      || "(tech)";
    out.push({
      key: `tech:${(t.hcp_employee_id as string | null) ?? name}`,
      source: "tech",
      name,
      subtitle: t.is_lead ? "Lead tech" : "Tech / staff",
      phoneE164: phone,
      recipientType: "tech",
      optedOut: !!t.sms_opt_out,
    });
  }

  for (const c of (contactsRes.data ?? []) as Array<Record<string, unknown>>) {
    const phone = toE164(c.phone_e164 as string | null);
    if (!phone) continue;
    const kind = (c.kind as string | null) ?? "other";
    out.push({
      key: `contact:${c.id as string}`,
      source: "contact",
      name: ((c.name as string | null) ?? "(contact)").trim(),
      subtitle: c.is_preferred ? `${kind} · preferred` : kind,
      phoneE164: phone,
      recipientType: recipientTypeForKind(kind),
      optedOut: false,
    });
  }

  for (const d of (distRes.data ?? []) as Array<Record<string, unknown>>) {
    const phone = toE164(d.phone as string | null);
    if (!phone) continue;
    const contactName = (d.contact_name as string | null)?.trim();
    out.push({
      key: `distributor:${d.id as string}`,
      source: "distributor",
      name: ((d.name as string | null) ?? "(distributor)").trim(),
      subtitle: contactName ? `Distributor · ${contactName}` : "Distributor / supplier",
      phoneE164: phone,
      recipientType: "vendor",
      optedOut: false,
    });
  }

  // Sort: techs first, then alpha by name within each source.
  const order: Record<BusinessContactSource, number> = { tech: 0, contact: 1, distributor: 2 };
  out.sort((a, b) => order[a.source] - order[b.source] || a.name.localeCompare(b.name));

  // Dedup by phone — the same number in tpar_contacts + distributors (e.g.
  // Ferguson/Locke seeded in both) should appear once. Sorted contact-before-
  // distributor above, so the richer contact row wins.
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.phoneE164) ? false : (seen.add(c.phoneE164), true)));
}
