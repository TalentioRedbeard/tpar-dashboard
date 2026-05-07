"use server";

// Manual-sync triggers, fired from the Update buttons in FreshnessStrip.
//
// Verification (added 2026-05-07): each click now snapshots the source's
// MAX(data timestamp) BEFORE firing, awaits the sync, then re-queries the
// same MAX. If the timestamp advanced → ✓. If sync errored or data didn't
// move → ✗ with reason. Closes the gap where a click on a broken source
// looked successful even though no new rows landed.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";

type SourceKey = "hcp" | "salesask" | "bouncie" | "texts" | "calls" | "embeddings";

export type SyncResult =
  | { ok: null }
  | { ok: true; source: SourceKey; before_iso: string | null; after_iso: string | null; advanced: boolean; message: string }
  | { ok: false; source: SourceKey; before_iso: string | null; after_iso: string | null; message: string };

const SUPABASE_FN_BASE = "https://bwpoqsfrygyopwxmegax.functions.supabase.co";
const SUPABASE_V1_BASE = "https://bwpoqsfrygyopwxmegax.supabase.co/functions/v1";
const HCP_BOT_BASE = "https://tpar-hcp-bot.fly.dev";

type Trigger = {
  url: string;
  auth: { kind: "service_role" } | { kind: "x-trigger-secret"; envKey: string } | { kind: "bearer"; envKey: string };
  body?: () => Record<string, unknown>;
  bodies?: () => Array<Record<string, unknown>>;
  // Verifier — query the source's data table, return ISO of latest row.
  verify: () => Promise<string | null>;
  // Generous timeout to wait for the sync to finish before re-querying.
  timeout_ms: number;
};

async function maxFromTable(table: string, col: string, eq?: { col: string; val: string }): Promise<string | null> {
  const supabase = db();
  let q = supabase.from(table).select(col).order(col, { ascending: false }).limit(1);
  if (eq) q = q.eq(eq.col, eq.val);
  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  return (data as unknown as Record<string, string | null>)[col] ?? null;
}

const TRIGGERS: Record<SourceKey, Trigger> = {
  hcp: {
    url: `${SUPABASE_FN_BASE}/hcp-sync-appointments`,
    auth: { kind: "service_role" },
    body: () => ({ daysBack: 1 }),
    verify: () => maxFromTable("appointments_master", "updated_at"),
    timeout_ms: 60_000,
  },
  salesask: {
    url: `${SUPABASE_V1_BASE}/salesask-sync`,
    auth: { kind: "x-trigger-secret", envKey: "SALESASK_SYNC_SECRET" },
    body: () => ({}),
    verify: () => maxFromTable("salesask_recordings", "updated_at"),
    timeout_ms: 60_000,
  },
  bouncie: {
    url: `${SUPABASE_V1_BASE}/bouncie-sync-trips`,
    auth: { kind: "service_role" },
    body: () => ({ syncVehicles: true, syncTrips: true, daysBack: 2 }),
    verify: () => maxFromTable("bouncie_trips", "ended_at"),
    timeout_ms: 60_000,
  },
  texts: {
    url: `${HCP_BOT_BASE}/extract-texts`,
    auth: { kind: "bearer", envKey: "HCP_BOT_API_TOKEN" },
    body: () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      return { date_from: today, date_to: today, max_channels: 100, max_messages_per_channel: 100 };
    },
    verify: () => maxFromTable("communication_events", "occurred_at", { col: "channel", val: "text" }),
    timeout_ms: 60_000,
  },
  calls: {
    url: `${HCP_BOT_BASE}/transcribe-calls`,
    auth: { kind: "bearer", envKey: "HCP_BOT_API_TOKEN" },
    body: () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      return { date_from: today, date_to: today, max_calls: 50 };
    },
    verify: () => maxFromTable("communication_events", "occurred_at", { col: "channel", val: "call" }),
    timeout_ms: 60_000,
  },
  embeddings: {
    url: `${SUPABASE_V1_BASE}/embed-events`,
    auth: { kind: "x-trigger-secret", envKey: "EMBED_TRIGGER_SECRET" },
    bodies: () => [
      { entity_type: "communication_event", limit: 500 },
      { entity_type: "customer", limit: 500 },
      { entity_type: "job", limit: 500 },
    ],
    verify: () => maxFromTable("entity_embeddings", "created_at"),
    timeout_ms: 60_000,
  },
};

function authHeaders(t: Trigger): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (t.auth.kind === "service_role") {
    headers["Authorization"] = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`;
  } else if (t.auth.kind === "x-trigger-secret") {
    headers["X-Trigger-Secret"] = process.env[t.auth.envKey] ?? "";
  } else {
    headers["Authorization"] = `Bearer ${process.env[t.auth.envKey] ?? ""}`;
  }
  return headers;
}

async function logManualTrigger(source: SourceKey, ok: boolean, status: number | null, errorMessage: string | null, advanced: boolean | null) {
  try {
    await db().from("maintenance_logs").insert({
      source: `manual-trigger:${source}`,
      level: ok ? "info" : "error",
      message: ok ? `manual sync — advanced=${advanced}` : "manual sync failed",
      context: { status, error: errorMessage, advanced, fired_at: new Date().toISOString() },
    });
  } catch {}
}

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export async function triggerSync(_prev: SyncResult, formData: FormData): Promise<SyncResult> {
  const raw = String(formData.get("source") ?? "");
  if (!(raw in TRIGGERS)) {
    return { ok: false, source: raw as SourceKey, before_iso: null, after_iso: null, message: `unknown source: ${raw}` };
  }
  const source = raw as SourceKey;
  const t = TRIGGERS[source];

  // 1. Snapshot before.
  const beforeIso = await t.verify().catch(() => null);

  // 2. Fire the sync, awaiting its full completion (most edge fns return after
  // the work is done; bot endpoints can take 30-60s).
  const headers = authHeaders(t);
  const bodies = t.bodies ? t.bodies() : [t.body ? t.body() : {}];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), t.timeout_ms);

  let firedOk = false;
  let firedStatus: number | null = null;
  let firedError: string | null = null;
  try {
    const results = await Promise.allSettled(
      bodies.map((body) => fetch(t.url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal })),
    );
    const firstOk = results.find((r) => r.status === "fulfilled" && r.value.ok);
    if (firstOk) {
      firedOk = true;
      firedStatus = firstOk.status === "fulfilled" ? firstOk.value.status : null;
    } else {
      const firstFail = results[0];
      firedStatus = firstFail?.status === "fulfilled" ? firstFail.value.status : null;
      firedError = firstFail?.status === "rejected" ? String((firstFail.reason as Error)?.message ?? firstFail.reason) : `non-2xx (${firedStatus})`;
    }
  } catch (e) {
    firedError = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timer);
  }

  // 3. Re-snapshot. Tiny pause to let upserts settle if the edge fn returns
  // before the row is committed.
  await new Promise((r) => setTimeout(r, 1500));
  const afterIso = await t.verify().catch(() => null);

  const advanced = !!(beforeIso && afterIso && new Date(afterIso).getTime() > new Date(beforeIso).getTime())
                || !!(afterIso && !beforeIso);

  await logManualTrigger(source, firedOk && advanced, firedStatus, firedError, advanced);
  revalidatePath("/", "layout");

  if (!firedOk) {
    return {
      ok: false,
      source, before_iso: beforeIso, after_iso: afterIso,
      message: `sync failed: ${firedError ?? `status ${firedStatus}`}`,
    };
  }
  if (advanced) {
    return {
      ok: true,
      source, before_iso: beforeIso, after_iso: afterIso, advanced: true,
      message: `✓ data advanced — now ${fmtAgo(afterIso)}`,
    };
  }
  return {
    ok: true,
    source, before_iso: beforeIso, after_iso: afterIso, advanced: false,
    message: `✓ sync ok, no new rows`,
  };
}
