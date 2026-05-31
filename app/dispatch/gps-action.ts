"use server";

// Server action backing the "Past GPS data" window on /dispatch (Danny 2026-05-31).
// Gated to dispatch roles (requireScheduler = admin/manager), then posts the
// question to the gps-query edge fn with the caller's session JWT (which
// re-checks the role + runs the read-only NL->SQL over GPS/trip data). Mirrors
// askBar (app/ask/bar-action.ts) but points at the GPS-scoped brain.

import { supabaseServer } from "../../lib/supabase-server";
import { requireScheduler } from "../../lib/current-tech";
import type { RoutePlan, RouteScope } from "../../components/AskResult";

const GPS_URL = `${process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/gps-query`;

export type GpsQueryResult = {
  ok: boolean;
  plan?: RoutePlan;
  rows?: Record<string, unknown>[];
  sql_error?: string | null;
  scope?: RouteScope | null;
  error?: string;
};

export async function gpsQuery(input: { question: string }): Promise<GpsQueryResult> {
  const question = (input.question ?? "").trim();
  if (!question) return { ok: false, error: "Type a GPS question first." };

  const gate = await requireScheduler();
  if (!gate.ok) return { ok: false, error: "Past GPS data is available to dispatch/management only." };

  const supa = await supabaseServer();
  const { data: sessionData } = await supa.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? null;
  if (!accessToken) return { ok: false, error: "You're signed out — refresh and sign in." };

  try {
    const res = await fetch(GPS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ question }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error ?? `gps-query ${res.status}` };
    return {
      ok: true,
      plan: json.plan as RoutePlan,
      rows: (json.rows as Record<string, unknown>[]) ?? [],
      sql_error: json.sql_error ?? null,
      scope: (json.scope as RouteScope) ?? null,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
