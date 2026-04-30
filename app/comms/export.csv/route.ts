// CSV export of comms matching the /comms filters.

import { db } from "../../../lib/supabase";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type CommRow = {
  id: number;
  occurred_at: string;
  channel: string;
  direction: string | null;
  hcp_customer_id: string | null;
  customer_name: string | null;
  tech_short_name: string | null;
  importance: number | null;
  sentiment: string | null;
  summary: string | null;
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
  const channel = (sp.get("channel") ?? "").trim();
  const tech = (sp.get("tech") ?? "").trim();
  const minImp = Number(sp.get("min_importance") ?? "0");
  const includeNoise = sp.get("include_noise") === "1";

  const supa = db();
  let query = supa
    .from("communication_events")
    .select("id, occurred_at, channel, direction, hcp_customer_id, customer_name, tech_short_name, importance, sentiment, summary");
  if (q) query = query.or(`customer_name.ilike.%${q}%,summary.ilike.%${q}%`);
  if (channel) query = query.eq("channel", channel);
  if (tech) query = query.eq("tech_short_name", tech);
  if (minImp > 0) query = query.gte("importance", minImp);
  if (!includeNoise && minImp === 0) query = query.gt("importance", 0);

  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as CommRow[];
  const header = [
    "occurred_at", "channel", "direction", "customer_name", "hcp_customer_id",
    "tech_short_name", "importance", "sentiment", "summary",
  ];
  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.occurred_at ?? "",
      r.channel ?? "",
      r.direction ?? "",
      r.customer_name ?? "",
      r.hcp_customer_id ?? "",
      r.tech_short_name ?? "",
      r.importance ?? "",
      r.sentiment ?? "",
      r.summary ?? "",
    ].map(csvCell).join(","));
  }

  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tpar_comms_${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
