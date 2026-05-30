"use server";

// After we send something to HCP (lifecycle trigger, new job, etc.), pull
// HCP's updated state back into appointments_master so our Schedule /
// Dispatch / My-day surfaces reflect the change immediately rather than
// waiting up to 30 min for the next tpar-appointments-sync cron.
//
// Fire-and-forget by default; await=true blocks until the sync returns.

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function bounceHcpAppointments(opts?: {
  daysBack?: number;
  daysForward?: number;
}): Promise<{ ok: boolean; error?: string }> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { ok: false, error: "Server misconfigured — SUPABASE_URL or SERVICE_KEY missing." };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/hcp-sync-appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        daysBack: opts?.daysBack ?? 1,
        daysForward: opts?.daysForward ?? 7,
      }),
    });
    if (!res.ok) return { ok: false, error: `hcp-sync-appointments ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
