// CSV export of jobs matching the same filters as /jobs page. Same auth
// path (middleware allowlist).

import { db } from "../../../lib/supabase";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type JobRow = {
  hcp_job_id: string;
  hcp_customer_id: string | null;
  customer_name: string | null;
  invoice_number: string | null;
  job_date: string | null;
  tech_primary_name: string | null;
  appointment_status: string | null;
  revenue: number | null;
  due_amount: number | null;
  days_outstanding: number | null;
  gross_margin_pct: number | null;
  on_time: boolean | null;
  gps_matched: boolean | null;
};

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest): Promise<Response> {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const tech = (sp.get("tech") ?? "").trim();
  const status = (sp.get("status") ?? "").trim();
  const outstandingOnly = sp.get("outstanding") === "1";
  const includeInternal = sp.get("include_internal") === "1";

  const supa = db();
  let query = supa
    .from("job_360")
    .select(
      "hcp_job_id, hcp_customer_id, customer_name, invoice_number, job_date, tech_primary_name, appointment_status, revenue, due_amount, days_outstanding, gross_margin_pct, on_time, gps_matched",
    );
  if (q)      query = query.or(`customer_name.ilike.%${q}%,invoice_number.ilike.%${q}%`);
  if (tech)   query = query.eq("tech_primary_name", tech);
  if (status) query = query.eq("appointment_status", status);
  if (outstandingOnly) query = query.gt("due_amount", 0);
  if (!includeInternal) {
    query = query.not("customer_name", "in", '("Tulsa Plumbing and Remodeling","TPAR","Spam","DMG","System")');
  }

  const { data, error } = await query
    .order("job_date", { ascending: false, nullsFirst: false })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as JobRow[];
  const header = [
    "job_date", "invoice_number", "customer_name", "hcp_customer_id",
    "tech_primary_name", "appointment_status",
    "revenue", "due_amount", "days_outstanding", "gross_margin_pct",
    "gps_matched", "on_time", "hcp_job_id",
  ];
  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.job_date ?? "",
      r.invoice_number ?? "",
      r.customer_name ?? "",
      r.hcp_customer_id ?? "",
      r.tech_primary_name ?? "",
      r.appointment_status ?? "",
      r.revenue != null ? Number(r.revenue).toFixed(2) : "",
      r.due_amount != null ? Number(r.due_amount).toFixed(2) : "",
      r.days_outstanding ?? "",
      r.gross_margin_pct != null ? Number(r.gross_margin_pct).toFixed(1) : "",
      r.gps_matched == null ? "" : r.gps_matched ? "yes" : "no",
      r.on_time == null ? "" : r.on_time ? "yes" : "no",
      r.hcp_job_id ?? "",
    ].map(csvCell).join(","));
  }

  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tpar_jobs_${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
