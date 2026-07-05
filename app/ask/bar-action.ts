"use server";

// Server action backing the global AskBar (the persistent AI bar under every
// page header). Posts the user's question + page context to appguide-route
// with their session JWT, so the brain applies the same role gating as /ask
// (admin/manager → all; tech → own data). Mirrors routeQuery in /ask/page.tsx
// but is callable from the client bar so answers render inline without a nav.

import { supabaseServer } from "../../lib/supabase-server";
import { getCurrentTech } from "../../lib/current-tech";
import type { RoutePlan, RouteScope } from "../../components/AskResult";

const ROUTE_URL = `${process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/appguide-route`;

export type AskBarResult = {
  ok: boolean;
  plan?: RoutePlan;
  rows?: Record<string, unknown>[];
  sql_error?: string | null;
  scope?: RouteScope | null;
  error?: string;
};

export async function askBar(input: { question: string; pageContext?: string }): Promise<AskBarResult> {
  const question = (input.question ?? "").trim();
  if (!question) return { ok: false, error: "Type a question first." };

  const supa = await supabaseServer();
  const { data: sessionData } = await supa.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? null;
  if (!accessToken) return { ok: false, error: "You're signed out — refresh and sign in." };

  // Personality levers (tech_directory.prefs, set on /settings): ride the
  // EXISTING page_context string so appguide-route needs no change. The edge fn
  // truncates page_context to 200 chars (appguide-route/index.ts slice(0,200)),
  // so the preference line goes FIRST — the levers are honored even if the page
  // tail gets clipped. Notes are capped here for the same reason (full text
  // stays in prefs). Additive only: no prefs → payload unchanged.
  let pageContext = input.pageContext ?? null;
  const prefs = (await getCurrentTech().catch(() => null))?.tech?.prefs;
  if (prefs && (prefs.detail_level || prefs.processing_notes)) {
    const parts: string[] = [];
    if (prefs.detail_level) parts.push(`User answer-style preference: ${prefs.detail_level}.`);
    if (typeof prefs.processing_notes === "string" && prefs.processing_notes.trim()) {
      parts.push(`Their own words on how they like information: ${prefs.processing_notes.trim().slice(0, 80)}.`);
    }
    pageContext = pageContext ? `${parts.join(" ")} | ${pageContext}` : parts.join(" ");
  }

  try {
    const res = await fetch(ROUTE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ question, page_context: pageContext }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error ?? `appguide-route ${res.status}` };
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
