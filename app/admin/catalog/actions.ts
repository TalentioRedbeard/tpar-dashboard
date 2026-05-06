// Feature catalog data sources. Mix of auto-discovery (DB queries) + a small
// manually-maintained list for things that don't live in the DB.
//
// NOTE: this file is NOT marked "use server" — it exports both async helpers
// and constant arrays (DASHBOARD_PAGES, MCP_TOOLS), and Next.js disallows
// non-function exports from a "use server" module. Imported by a server
// component (page.tsx), so the helpers run server-side regardless.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

export type CatalogCron = {
  jobid: number;
  jobname: string;
  schedule: string;
  active: boolean;
  command_preview: string;
};

export type CatalogEdgeFn = {
  source: string;            // edge fn name (matches maintenance_logs.source)
  recent_24h: number;
  last_seen: string | null;
  last_level: string | null;
};

export type CatalogSlackCmd = {
  command: string;
  description: string;
  url: string;
};

export type CatalogPage = {
  path: string;
  description: string;
  surface: "admin" | "manager" | "tech" | "all";
};

export type CatalogMcpTool = {
  name: string;
  description: string;
  category: "tpar" | "browser" | "external";
};

async function requireLeadership(): Promise<boolean> {
  const me = await getCurrentTech();
  return !!me && (me.isAdmin || me.isManager);
}

export async function getCatalogCrons(): Promise<CatalogCron[]> {
  if (!await requireLeadership()) return [];
  const supabase = db();
  const { data } = await supabase
    .rpc("catalog_list_crons")
    .select() as any;
  // Fallback: query directly. The function may not exist; do raw SQL via PostgREST is hard,
  // so we use a pre-existing RPC if registered or fall back to inline query through the
  // service-role rest client. Easier: query via the supabase client directly.
  // (We already fetch cron data elsewhere via psql — at runtime the dashboard reaches the DB
  // through PostgREST which can read pg_cron via a SECURITY DEFINER view if we expose one.
  // For v0, we expose what we have via maintenance_logs + a static cron map.)
  if (Array.isArray(data) && data.length > 0) return data as CatalogCron[];

  // Fallback path: query cron.job directly via a bare REST call (works because service-role
  // bypasses RLS but cron is in another schema, so direct PostgREST won't reach it).
  // Instead, use a curated list of known cron names for v0; real-time numbers are in
  // /admin (or via direct DB).
  return [];
}

// Active edge functions = anything that's logged to maintenance_logs in last 7 days.
// Catches ~all active edge fns since most log either on success or error.
export async function getActiveEdgeFns(): Promise<CatalogEdgeFn[]> {
  if (!await requireLeadership()) return [];
  const supabase = db();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data } = await supabase
    .from("maintenance_logs")
    .select("source, level, ts")
    .gte("ts", sevenDaysAgo)
    .order("ts", { ascending: false })
    .limit(2000);

  if (!data) return [];

  const bySource = new Map<string, { count: number; lastSeen: string; lastLevel: string }>();
  for (const r of data as any[]) {
    const s = r.source as string;
    const existing = bySource.get(s);
    if (existing) {
      existing.count += 1;
    } else {
      bySource.set(s, { count: 1, lastSeen: r.ts as string, lastLevel: r.level as string });
    }
  }

  return [...bySource.entries()]
    .map(([source, v]) => ({
      source,
      recent_24h: v.count,
      last_seen: v.lastSeen,
      last_level: v.lastLevel,
    }))
    .sort((a, b) => (b.recent_24h - a.recent_24h));
}

// Manually-maintained list of dashboard surfaces. Update when adding pages.
export const DASHBOARD_PAGES: CatalogPage[] = [
  { path: "/",                         surface: "all",     description: "Role-aware home — AdminHome (intent launcher) for leadership; TechHome (scope-limited) for techs." },
  { path: "/me",                       surface: "tech",    description: "My day — tech's per-appointment view + clock-in." },
  { path: "/time",                     surface: "all",     description: "Time-tracking surface — entries + corrections." },
  { path: "/jobs",                     surface: "all",     description: "All jobs (filterable by tech/status/customer)." },
  { path: "/job/[id]",                 surface: "all",     description: "Per-job 360 — comms, photos, estimates, notes, lifecycle triggers, membership, procurement needs, SalesAsk recordings." },
  { path: "/customers",                surface: "all",     description: "Customer list with leaders + open follow-up clusters." },
  { path: "/customer/[id]",            surface: "all",     description: "Customer 360 — lifetime stats, recent comms, jobs, agreements, membership, similar customers." },
  { path: "/dispatch",                 surface: "all",     description: "7-day appointment grid grouped by date." },
  { path: "/comms",                    surface: "all",     description: "Communication events (calls/texts/emails) — filterable, search, mark-handled." },
  { path: "/estimates",                surface: "all",     description: "Estimate list (across techs)." },
  { path: "/shopping",                 surface: "all",     description: "Procurement / shopping list — log a need, research vendors, mark fulfilled." },
  { path: "/membership/enroll",        surface: "all",     description: "Tech-led membership enrollment with tier picker + 'no-brainer math' panel." },
  { path: "/receipt",                  surface: "all",     description: "Web receipt upload — photo + invoice + amount, writes to receipts_master." },
  { path: "/voice-notes",              surface: "all",     description: "Voice notes — record/upload audio, Whisper transcribes, use as Based-on… reference for estimate generation." },
  { path: "/photos",                   surface: "all",     description: "Web photo upload for jobs — photo + job picker, writes to photo_labels." },
  { path: "/snap",                     surface: "admin",   description: "Snap-server (screenshot Danny's laptop) + Push-key (send keystroke). Local PowerShell poller." },
  { path: "/alarms",                   surface: "admin",   description: "Wake-up alarm management — Twilio-driven persistent calling + DTMF auth." },
  { path: "/admin",                    surface: "admin",   description: "Admin home — operational tools index." },
  { path: "/admin/view-as",            surface: "manager", description: "View-as-tech impersonation — preview the scope-limited tech dashboard." },
  { path: "/admin/salesask",           surface: "manager", description: "SalesAsk recording binding review — confirm / re-link / unbind." },
  { path: "/admin/catalog",            surface: "manager", description: "This page — feature catalog of every system surface." },
  { path: "/admin/usage",              surface: "manager", description: "Dashboard usage analytics — who hits which pages, how often." },
  { path: "/admin/concerns",           surface: "manager", description: "Leadership review queue — voice notes flagged for discussion. Resolve in-place with a short note." },
  { path: "/admin/leads",              surface: "manager", description: "New-lead queue — inbound prospects flagged by the classifier. Per-row contact extraction + mark-handled. Surfaced 2026-05-05." },
  { path: "/reports/ar",               surface: "all",     description: "Accounts receivable detail." },
  { path: "/reports/patterns",         surface: "all",     description: "Customer recurring-pattern detection (preventative candidates)." },
  { path: "/price",                    surface: "all",     description: "Pricebook lookup — items + sell prices + categories." },
  { path: "/ask",                      surface: "all",     description: "Ask TPAR — natural-language query interface to the knowledge layer." },
  { path: "/search",                   surface: "all",     description: "Cross-entity search (customers + jobs + comms + estimates)." },
];

// Manually-maintained list of MCP tools exposed by mcp-tpar.
// Update when extending the MCP server.
export const MCP_TOOLS: CatalogMcpTool[] = [
  { name: "tpar_ask",                  category: "tpar", description: "Ask the TPAR knowledge layer (routes to ask-tpar)." },
  { name: "tpar_query_db",             category: "tpar", description: "Read-only SQL against TPAR-DB (Postgres SELECT)." },
  { name: "tpar_get_job",              category: "tpar", description: "Fetch a job by hcp_job_id with full 360 context." },
  { name: "tpar_get_appointments",     category: "tpar", description: "Today/upcoming appointments by tech or all." },
  { name: "tpar_dm_team",              category: "tpar", description: "DM a teammate via Slack." },
  { name: "tpar_resolve_probable_job", category: "tpar", description: "Resolve a slack_user_id (+ optional ts) → likely job + customer + address." },
  { name: "tpar_receipt_batch",        category: "tpar", description: "Trigger receipt-csv-batch for Kelsey's bookkeeping." },
  { name: "tpar_followup_queue",       category: "tpar", description: "Pending follow-ups across customers." },
  { name: "tpar_customer_360",         category: "tpar", description: "Customer 360 view by hcp_customer_id." },
  { name: "tpar_job_360",              category: "tpar", description: "Job 360 view by hcp_job_id." },
  { name: "tpar_pip_report",           category: "tpar", description: "Pull a PIP / margin report." },
  { name: "tpar_call_danny",           category: "tpar", description: "Trigger an outbound voice call to Danny via Twilio." },
  { name: "tpar_search_similar",       category: "tpar", description: "Vector-similarity search across embedded entities." },
  { name: "tpar_find_similar_customers", category: "tpar", description: "Find similar customers by embedding." },
  { name: "tpar_find_similar_jobs",    category: "tpar", description: "Find similar jobs by embedding." },
  { name: "tpar_append_estimate_lines", category: "tpar", description: "Append line items to an HCP estimate via the bot bridge." },
  { name: "browser_navigate",          category: "browser", description: "Navigate the headless browser to a URL." },
  { name: "browser_click",             category: "browser", description: "Click an element by selector." },
  { name: "browser_type",              category: "browser", description: "Type into an input." },
  { name: "browser_get_text",          category: "browser", description: "Read text from a selector." },
  { name: "browser_get_html",          category: "browser", description: "Read HTML from a selector." },
  { name: "browser_screenshot",        category: "browser", description: "Take a screenshot." },
  { name: "browser_wait_for",          category: "browser", description: "Wait for an element/condition." },
  { name: "browser_current_url",       category: "browser", description: "Get the current URL." },
  { name: "browser_save_session",      category: "browser", description: "Save the browser session for later replay." },
];
