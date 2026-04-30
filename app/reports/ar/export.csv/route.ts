// CSV export of the open-AR list. Same auth path as the page (middleware
// allowlist on tulsapar.com emails). Kelsey pulls this when she works
// collections — the page is for browsing, the CSV is for spreadsheet ops.

import { db } from "../../../../lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ARRow = {
  hcp_job_id: string;
  hcp_customer_id: string | null;
  customer_name: string | null;
  invoice_number: string | null;
  job_date: string | null;
  tech_primary_name: string | null;
  due_amount: number | null;
  days_outstanding: number | null;
};

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  // Escape if contains quote, comma, or newline
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function bucket(days: number | null): string {
  if (days == null) return "";
  if (days <= 7) return "0-7";
  if (days <= 30) return "8-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export async function GET(): Promise<Response> {
  const supa = db();
  const { data, error } = await supa
    .from("job_360")
    .select("hcp_job_id, hcp_customer_id, customer_name, invoice_number, job_date, tech_primary_name, due_amount, days_outstanding")
    .gt("due_amount", 0)
    .order("days_outstanding", { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as ARRow[];
  const header = [
    "job_date",
    "invoice_number",
    "customer_name",
    "hcp_customer_id",
    "tech_primary_name",
    "due_amount",
    "days_outstanding",
    "aging_bucket",
    "hcp_job_id",
  ];
  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.job_date ?? "",
      r.invoice_number ?? "",
      r.customer_name ?? "",
      r.hcp_customer_id ?? "",
      r.tech_primary_name ?? "",
      r.due_amount != null ? Number(r.due_amount).toFixed(2) : "",
      r.days_outstanding ?? "",
      bucket(r.days_outstanding),
      r.hcp_job_id ?? "",
    ].map(csvCell).join(","));
  }

  const csv = lines.join("\n");
  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tpar_ar_open_${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
