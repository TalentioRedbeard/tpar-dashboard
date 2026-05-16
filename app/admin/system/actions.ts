"use server";

// Server actions for /admin/system. Today: a "Sync now" trigger that
// fires the sync-fn-manifest edge fn out-of-band so Danny doesn't have to
// wait for the 06:37 UTC nightly run after a deploy.

import { revalidatePath } from "next/cache";

export async function syncFnManifest(): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    return { ok: false, error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in env" };
  }

  try {
    const res = await fetch(`${url}/functions/v1/sync-fn-manifest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({}),
      // 90s — sync touches ~106 fns, each with a Management API call.
      signal: AbortSignal.timeout(90_000),
    });
    const body = await res.json().catch(() => ({}));
    revalidatePath("/admin/system");
    return { ok: res.ok, result: body, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function regenOntology(): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    return { ok: false, error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in env" };
  }

  try {
    const res = await fetch(`${url}/functions/v1/regen-system-ontology`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json().catch(() => ({}));
    revalidatePath("/admin/ontology");
    return { ok: res.ok, result: body, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
