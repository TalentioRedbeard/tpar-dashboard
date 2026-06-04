"use server";

// Re-run the integration-probe on demand from /admin/integrations. Calls the
// edge fn with the service-role bearer (which the probe accepts), waits for it
// to finish writing credential_health (~10-15s), then revalidates the page.

import { revalidatePath } from "next/cache";
import { getCurrentTech } from "../../../lib/current-tech";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function retestIntegrations(): Promise<void> {
  const me = await getCurrentTech();
  if (!me || (!me.isAdmin && !me.isManager)) return;
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/integration-probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: "{}",
    });
  } catch {
    /* the page just shows the prior snapshot if the probe call fails */
  }
  revalidatePath("/admin/integrations");
}
