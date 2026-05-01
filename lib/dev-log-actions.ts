// Server actions for /admin/dev-log — manual run of the compaction.
// Admin-only. Bridges to the dev-session-compact edge function, which is
// the same path the nightly cron uses.

"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "./supabase-server";
import { isAdmin } from "./admin";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const COMPACT_SECRET = process.env.DEV_SESSION_COMPACT_SECRET ?? "";

export type CompactResult =
  | { ok: true; date_chi: string; log_count: number; summary_chars?: number }
  | { ok: false; error: string };

export async function runCompactNow(formData: FormData): Promise<CompactResult> {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) return { ok: false, error: "admin only" };
  if (!SUPABASE_URL || !COMPACT_SECRET) return { ok: false, error: "server config missing" };

  const dateChi = String(formData.get("date_chi") ?? "").trim();
  const body: Record<string, unknown> = {};
  if (dateChi) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateChi)) return { ok: false, error: "date must be YYYY-MM-DD" };
    body.date_chi = dateChi;
  }

  const r = await fetch(`${SUPABASE_URL}/functions/v1/dev-session-compact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Trigger-Secret": COMPACT_SECRET,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) return { ok: false, error: `compact failed: HTTP ${r.status} — ${text.slice(0, 200)}` };

  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "compact returned non-JSON" }; }
  if (!parsed.ok) return { ok: false, error: String(parsed.error ?? "compact returned ok=false") };

  revalidatePath("/admin/dev-log");
  return {
    ok: true,
    date_chi: String(parsed.date_chi ?? dateChi ?? ""),
    log_count: Number(parsed.log_count ?? 0),
    summary_chars: typeof parsed.summary_chars === "number" ? parsed.summary_chars : undefined,
  };
}
