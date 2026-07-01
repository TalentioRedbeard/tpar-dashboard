"use server";

// Server action behind /conversation — the talk-back loop. Calls the `converse`
// edge fn (reads the recent office-ambient transcript → Claude as thinking partner
// → reflection + questions + captured tasks). Service-role auth + 30s bound (LLM
// round-trip; pg_net's 5s cap doesn't apply to a server-action fetch). Owner-gated,
// matching the page. Consequence tier T1 — returns text + PROPOSED tasks; writes nothing.

import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";

const FN_URL = "https://bwpoqsfrygyopwxmegax.supabase.co/functions/v1/converse";

export type CapturedTask = { title: string; detail: string };
export type ConverseResult =
  | { ok: null }
  | { ok: true; reply: string; questions: string[]; captured_tasks: CapturedTask[] }
  | { ok: false; message: string };

export async function respond(_prev: ConverseResult, formData: FormData): Promise<ConverseResult> {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) return { ok: false, message: "owner only" };

  const sinceMinutes = Math.max(1, Math.min(120, Number(formData.get("since_minutes") ?? 15)));
  const pageContext = String(formData.get("page_context") ?? "").trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const resp = await fetch(FN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
      },
      body: JSON.stringify({ since_minutes: sinceMinutes, page_context: pageContext || undefined }),
      signal: controller.signal,
    });
    const j = (await resp.json().catch(() => ({}))) as {
      ok?: boolean; error?: string; reply?: string; questions?: string[]; captured_tasks?: CapturedTask[];
    };
    if (!resp.ok || !j.ok) return { ok: false, message: j.error ?? `couldn't respond (status ${resp.status})` };
    return {
      ok: true,
      reply: j.reply ?? "",
      questions: Array.isArray(j.questions) ? j.questions : [],
      captured_tasks: Array.isArray(j.captured_tasks) ? j.captured_tasks : [],
    };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "timed out (>30s)" : e.message) : String(e);
    return { ok: false, message: msg };
  } finally {
    clearTimeout(timer);
  }
}
