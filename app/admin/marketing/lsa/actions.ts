"use server";

// Server actions for /admin/marketing/lsa.
//
// Manual CSV upload path: until the LSA bot is seeded + live, Danny exports
// the leads CSV from ads.google.com/local-services-ads ("DOWNLOAD" button)
// and uploads it here. We parse + fingerprint + upsert via the
// store-lsa-leads bridge (same path the bot will eventually use).
//
// Same parse + fingerprint logic as scripts/smoke-lsa-csv.ts in tpar-hcp-bot
// — kept inlined here rather than extracted to a shared lib until we have a
// 3rd consumer.

import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { isAdmin } from "@/lib/admin";
import { getSessionUser } from "@/lib/supabase-server";

const LSA_BRIDGE_URL =
  process.env.LSA_BRIDGE_URL ??
  "https://bwpoqsfrygyopwxmegax.functions.supabase.co/store-lsa-leads";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type CsvRow = {
  customer: string;
  job_type: string;
  search_intent: string;
  location: string;
  lead_type: string;
  charge_status: string;
  lead_received: string;
  last_activity: string;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (c === "," && !inQuote) {
      out.push(cur); cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseLsaCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]!).map((h) =>
    h.toLowerCase().replace(/\s+/g, "_"),
  );
  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
    rows.push(row as unknown as CsvRow);
  }
  return rows;
}

function parseLsaDate(s: string): string | null {
  if (!s) return null;
  const m = s.match(/^([A-Za-z]+)\s+(\d+)\s+(\d{4})$/);
  if (!m) return null;
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const month = months[m[1]!.slice(0, 3)];
  if (!month) return null;
  return `${m[3]}-${month}-${m[2]!.padStart(2, "0")}`;
}

function extractPhoneFromCustomer(customer: string): string | null {
  const m = customer.match(/\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/);
  return m ? `+1${m[1]}${m[2]}${m[3]}` : null;
}

function fingerprint(row: CsvRow): string {
  const baseName = (row.customer || "").replace(/\s*[-,].*$/, "").trim().toLowerCase();
  const key = `${row.lead_received}|${row.lead_type}|${row.location}|${baseName}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}

export type UploadResult =
  | { ok: true; rows_seen: number; rows_posted: number; upserted: number }
  | { ok: false; error: string };

export async function uploadLsaCsv(_prev: unknown, formData: FormData): Promise<UploadResult> {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) {
    return { ok: false, error: "Forbidden — admin only." };
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not configured server-side." };
  }

  const file = formData.get("csv");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a CSV file first." };
  }
  if (file.size > 5_000_000) {
    return { ok: false, error: "File too large (>5 MB). LSA exports should be tiny." };
  }

  const text = await file.text();
  const rows = parseLsaCsv(text);
  if (rows.length === 0) {
    return { ok: false, error: "No rows parsed — is this an LSA leads CSV?" };
  }

  // Sanity-check the header by looking for at least one expected column.
  const expectedHeaders = ["customer", "job_type", "lead_type", "charge_status", "lead_received"];
  const hasExpected = expectedHeaders.some((h) => Object.prototype.hasOwnProperty.call(rows[0]!, h));
  if (!hasExpected) {
    return {
      ok: false,
      error: `CSV doesn't look like an LSA leads export (no expected columns). Got: ${Object.keys(rows[0]!).join(", ").slice(0, 200)}`,
    };
  }

  const leads = rows.map((r) => ({
    lsa_lead_id: fingerprint(r),
    caller_phone: extractPhoneFromCustomer(r.customer),
    caller_name: r.customer || null,
    caller_zip: null,
    service_category: r.job_type || null,
    business_message: null,
    full_message: null,
    call_recording_url: null,
    status: r.charge_status || null,
    charge_amount_cents: null,
    dispute_status: null,
    dispute_reason_code: null,
    received_at: parseLsaDate(r.lead_received),
    closed_at: null,
    raw_row_text: JSON.stringify({
      customer: r.customer,
      job_type: r.job_type,
      search_intent: r.search_intent,
      location: r.location,
      lead_type: r.lead_type,
      charge_status: r.charge_status,
      lead_received: r.lead_received,
      last_activity: r.last_activity,
    }).slice(0, 4000),
  }));

  const res = await fetch(LSA_BRIDGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ leads }),
  });
  const body = (await res.json().catch(() => ({}))) as { upserted?: number; error?: string };

  if (!res.ok) {
    return { ok: false, error: `Bridge ${res.status}: ${body.error ?? "unknown error"}` };
  }

  revalidatePath("/admin/marketing/lsa");
  return {
    ok: true,
    rows_seen: rows.length,
    rows_posted: leads.length,
    upserted: body.upserted ?? leads.length,
  };
}
