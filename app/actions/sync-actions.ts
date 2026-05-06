"use server";

// Manual-sync triggers, fired from the Update buttons in FreshnessStrip.
//
// Each source maps to the same edge fn / endpoint that its scheduled cron hits,
// using the same auth method. Fire-and-forget — we POST and return immediately;
// the actual sync runs at the edge fn. revalidatePath nudges the AdminHome to
// re-render so the freshness pill picks up the eventual MAX(ts) bump.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";

type SourceKey = "hcp" | "salesask" | "bouncie" | "texts" | "calls" | "embeddings";

const SUPABASE_FN_BASE = "https://bwpoqsfrygyopwxmegax.functions.supabase.co";
const SUPABASE_V1_BASE = "https://bwpoqsfrygyopwxmegax.supabase.co/functions/v1";
const HCP_BOT_BASE = "https://tpar-hcp-bot.fly.dev";

type Trigger = {
  url: string;
  auth:
    | { kind: "service_role" }
    | { kind: "x-trigger-secret"; envKey: string }
    | { kind: "bearer"; envKey: string };
  // Some endpoints expect a non-empty body. Pulled from each cron's command.
  body?: () => Record<string, unknown>;
  // Multiple POSTs (embed-events fans out across entity types).
  bodies?: () => Array<Record<string, unknown>>;
};

const TRIGGERS: Record<SourceKey, Trigger> = {
  hcp: {
    url: `${SUPABASE_FN_BASE}/hcp-sync-appointments`,
    auth: { kind: "service_role" },
    body: () => ({ daysBack: 1 }),
  },
  salesask: {
    url: `${SUPABASE_V1_BASE}/salesask-sync`,
    auth: { kind: "x-trigger-secret", envKey: "SALESASK_SYNC_SECRET" },
    body: () => ({}),
  },
  bouncie: {
    url: `${SUPABASE_V1_BASE}/bouncie-sync-trips`,
    auth: { kind: "service_role" },
    body: () => ({ syncVehicles: true, syncTrips: true, daysBack: 2 }),
  },
  texts: {
    url: `${HCP_BOT_BASE}/extract-texts`,
    auth: { kind: "bearer", envKey: "HCP_BOT_API_TOKEN" },
    body: () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      return { date_from: today, date_to: today, max_channels: 100, max_messages_per_channel: 100 };
    },
  },
  calls: {
    url: `${HCP_BOT_BASE}/transcribe-calls`,
    auth: { kind: "bearer", envKey: "HCP_BOT_API_TOKEN" },
    body: () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      return { date_from: today, date_to: today, max_calls: 50 };
    },
  },
  embeddings: {
    url: `${SUPABASE_V1_BASE}/embed-events`,
    auth: { kind: "x-trigger-secret", envKey: "EMBED_TRIGGER_SECRET" },
    bodies: () => [
      { entity_type: "communication_event", limit: 500 },
      { entity_type: "customer", limit: 500 },
      { entity_type: "job", limit: 500 },
    ],
  },
};

function authHeaders(t: Trigger): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (t.auth.kind === "service_role") {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    headers["Authorization"] = `Bearer ${key}`;
  } else if (t.auth.kind === "x-trigger-secret") {
    headers["X-Trigger-Secret"] = process.env[t.auth.envKey] ?? "";
  } else if (t.auth.kind === "bearer") {
    headers["Authorization"] = `Bearer ${process.env[t.auth.envKey] ?? ""}`;
  }
  return headers;
}

async function logManualTrigger(source: SourceKey, ok: boolean, status: number | null, errorMessage: string | null) {
  try {
    await db().from("maintenance_logs").insert({
      source: `manual-trigger:${source}`,
      level: ok ? "info" : "error",
      message: ok ? "fired from FreshnessStrip" : "fire failed",
      context: { status, error: errorMessage, fired_at: new Date().toISOString() },
    });
  } catch {
    /* never blocks */
  }
}

export async function triggerSync(formData: FormData): Promise<void> {
  const raw = String(formData.get("source") ?? "");
  if (!(raw in TRIGGERS)) {
    await logManualTrigger(raw as SourceKey, false, null, `unknown source: ${raw}`);
    return;
  }
  const source = raw as SourceKey;
  const t = TRIGGERS[source];
  const headers = authHeaders(t);

  const bodies = t.bodies ? t.bodies() : [t.body ? t.body() : {}];

  // Fire-and-forget but with a short timeout so a hung downstream doesn't wedge
  // the action. The edge fns themselves keep running past our abort.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const results = await Promise.allSettled(
      bodies.map((body) =>
        fetch(t.url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
      ),
    );

    const firstOk = results.find((r) => r.status === "fulfilled" && r.value.ok);
    const firstFail = results.find((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok));

    if (firstOk) {
      const status = firstOk.status === "fulfilled" ? firstOk.value.status : null;
      await logManualTrigger(source, true, status, null);
    } else if (firstFail) {
      const status = firstFail.status === "fulfilled" ? firstFail.value.status : null;
      const err = firstFail.status === "rejected" ? String((firstFail.reason as Error)?.message ?? firstFail.reason) : `non-2xx`;
      await logManualTrigger(source, false, status, err);
    }
  } catch (e) {
    await logManualTrigger(source, false, null, e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }

  revalidatePath("/", "layout");
}
