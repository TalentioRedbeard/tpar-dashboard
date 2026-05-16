"use server";

// Server actions for /admin/system. Form-action versions return void so they
// satisfy `<form action={...}>`'s type. Outcome is logged + page-revalidated
// so the user sees fresh data on next render.

import { revalidatePath } from "next/cache";

export async function syncFnManifest(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    console.warn("[syncFnManifest] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in env");
    return;
  }
  try {
    const res = await fetch(`${url}/functions/v1/sync-fn-manifest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      console.warn(`[syncFnManifest] HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn(`[syncFnManifest] ${(e as Error).message}`);
  }
  revalidatePath("/admin/system");
}

export async function regenOntology(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    console.warn("[regenOntology] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in env");
    return;
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
    if (!res.ok) {
      console.warn(`[regenOntology] HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn(`[regenOntology] ${(e as Error).message}`);
  }
  revalidatePath("/admin/ontology");
}
