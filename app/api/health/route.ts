// Lightweight health endpoint. Public — middleware allows /api/health.
// Returns DB connectivity check + a 24h maintenance_logs summary so an
// external monitor can detect when the system stops emitting events.
//
// Designed to be cheap: 2 SELECTs, both on indexed columns.
//
// Response shape:
//   {
//     ok: boolean,
//     ts: ISO timestamp,
//     db: 'reachable' | 'error',
//     recent_24h: { events: number, errors: number, warnings: number, by_source: {...} }
//   }
//
// HTTP 200 when ok=true, 503 otherwise. Body always returned.

import { db } from "../../../lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const supa = db();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let dbStatus: "reachable" | "error" = "reachable";
  let dbErrorMessage: string | null = null;
  let events = 0, errors = 0, warnings = 0;
  const bySource: Record<string, { events: number; errors: number }> = {};

  try {
    // True total count (not row-fetch-limited) via head + count=exact
    const totalRes = await supa
      .from("maintenance_logs")
      .select("*", { count: "exact", head: true })
      .gte("ts", since24h);
    if (totalRes.error) {
      dbStatus = "error";
      dbErrorMessage = totalRes.error.message;
    } else {
      events = totalRes.count ?? 0;
    }

    // Errors + warnings — usually small, fetch the rows
    if (dbStatus === "reachable") {
      const errRes = await supa
        .from("maintenance_logs")
        .select("source, level")
        .gte("ts", since24h)
        .in("level", ["error", "warn"])
        .limit(2000);
      if (errRes.error) {
        dbStatus = "error";
        dbErrorMessage = errRes.error.message;
      } else {
        for (const r of (errRes.data ?? []) as Array<{ source: string; level: string }>) {
          const src = r.source ?? "(unknown)";
          if (!bySource[src]) bySource[src] = { events: 0, errors: 0 };
          if (r.level === "error") {
            errors += 1;
            bySource[src].errors += 1;
            bySource[src].events += 1;
          } else if (r.level === "warn") {
            warnings += 1;
            bySource[src].events += 1;
          }
        }
      }
    }
  } catch (err) {
    dbStatus = "error";
    dbErrorMessage = err instanceof Error ? err.message : String(err);
  }

  // Sort by_source by events desc, top 15
  const topSources = Object.entries(bySource)
    .sort((a, b) => b[1].events - a[1].events)
    .slice(0, 15)
    .reduce<Record<string, { events: number; errors: number }>>((acc, [k, v]) => {
      acc[k] = v;
      return acc;
    }, {});

  const body = {
    ok: dbStatus === "reachable",
    ts: new Date().toISOString(),
    db: dbStatus,
    db_error: dbErrorMessage,
    recent_24h: {
      events,
      errors,
      warnings,
      top_sources: topSources,
    },
  };

  return NextResponse.json(body, {
    status: body.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
