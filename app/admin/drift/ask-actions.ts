"use server";

// Server action behind the /admin/drift "ask the system" box. Calls the
// tpar-it-ask edge fn (IT-bot Phase 2: grounded retrieval over the typed estate
// → Claude). Service-role auth + a 30s timeout (the fn does an LLM round-trip;
// pg_net's 5s default is why callers must allow >5s — a server-action fetch has
// no such cap, but we still bound it). Admin-only, matching the page gate.

import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";

const FN_URL = "https://bwpoqsfrygyopwxmegax.supabase.co/functions/v1/tpar-it-ask";

export type AskMode = "ask" | "verify";

export type AskResult =
  | { ok: null }
  | { ok: true; mode: AskMode; question: string; result: Record<string, unknown>; retrieval: Record<string, number> }
  | { ok: false; message: string };

export async function askTheSystem(_prev: AskResult, formData: FormData): Promise<AskResult> {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) return { ok: false, message: "admin only" };

  const question = String(formData.get("question") ?? "").trim();
  const mode: AskMode = String(formData.get("mode") ?? "ask") === "verify" ? "verify" : "ask";
  if (!question) return { ok: false, message: "Enter a question." };
  if (question.length > 1000) return { ok: false, message: "Question too long (max 1000 chars)." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const resp = await fetch(FN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
      },
      body: JSON.stringify({ question, mode }),
      signal: controller.signal,
    });
    const json = (await resp.json().catch(() => ({}))) as {
      ok?: boolean; error?: string; result?: Record<string, unknown>; retrieval?: Record<string, number>;
    };
    if (!resp.ok || !json.ok || !json.result) {
      return { ok: false, message: json.error ?? `the system couldn't answer (status ${resp.status})` };
    }
    return { ok: true, mode, question, result: json.result, retrieval: json.retrieval ?? {} };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "timed out (>30s)" : e.message) : String(e);
    return { ok: false, message: msg };
  } finally {
    clearTimeout(timer);
  }
}
