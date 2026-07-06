"use server";

// Server action for the "Push to Danny" escalation footer on the Ask
// surfaces (the AskBar's inline answer + /ask). Thin service-role bridge to
// the ask-escalate edge fn (same lane as line-item-conversation-actions):
// the fn owns the cooldown, Danny/tech phone lookup, and the actual call
// (TTS read-out for can_wait, tech-first bridge for urgent) — this action
// just gates (any signed-in user, the same bar the AskBar's own action
// applies), attributes the actor from getCurrentTech(), and normalizes the
// contract's error shapes so the client can render exact states:
//
//   {ok:true, mode:'tts_call'|'bridge'}
//   {ok:false, error:'cooldown', retry_after_s}
//   {ok:false, error:'no_phone_on_file', hint}
//   {ok:false, error}

import { supabaseServer } from "./supabase-server";
import { getCurrentTech } from "./current-tech";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ESCALATE_URL = `${SUPABASE_URL}/functions/v1/ask-escalate`;

export type PushUrgency = "can_wait" | "urgent";

// Discriminated on `error` so the client narrows cleanly:
//   "cooldown"          → carries retryAfterS (seconds)
//   "no_phone_on_file"  → carries the backend's hint (may be null)
//   "failed"            → generic; human message in `message`
export type PushToDannyResult =
  | { ok: true; mode: "tts_call" | "bridge" }
  | { ok: false; error: "cooldown"; retryAfterS: number }
  | { ok: false; error: "no_phone_on_file"; hint: string | null }
  | { ok: false; error: "failed"; message: string };

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function pushToDanny(input: {
  question: string;
  answerSnippet?: string;
  urgency: PushUrgency;
  pageContext?: string;
  dryRun?: boolean;
}): Promise<PushToDannyResult> {
  const question = (input.question ?? "").trim().slice(0, 2000);
  if (!question) return { ok: false, error: "failed", message: "No question to send." };
  // Never let a malformed client value escalate to a live call by accident.
  const urgency: PushUrgency = input.urgency === "urgent" ? "urgent" : "can_wait";

  // Same gate as the AskBar's own action (app/ask/bar-action.ts): any
  // signed-in user. The session proves identity; the fn call itself rides
  // the service key below.
  const supa = await supabaseServer();
  const { data: sessionData } = await supa.auth.getSession();
  if (!sessionData.session?.access_token) {
    return { ok: false, error: "failed", message: "You're signed out — refresh and sign in." };
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { ok: false, error: "failed", message: "Server isn't configured for this yet (missing SUPABASE_URL / service-role key)." };
  }

  // Actor = the effective tech identity (works for view-as too, matching how
  // the rest of the app attributes actions). Falls back to the identity email
  // for signed-in office users without a tech row — the backend decides what
  // it can do with that (e.g. no_phone_on_file for a bridge).
  const me = await getCurrentTech().catch(() => null);
  if (!me) return { ok: false, error: "failed", message: "You're signed out — refresh and sign in." };
  const actor: Record<string, unknown> = {
    tech_short_name: me.tech?.tech_short_name || me.email,
  };
  if (me.tech?.tech_id) actor.tech_id = me.tech.tech_id;

  const body: Record<string, unknown> = { question, urgency, actor };
  const snippet = (input.answerSnippet ?? "").trim();
  if (snippet) body.answer_snippet = snippet.slice(0, 200);
  const pageContext = (input.pageContext ?? "").trim();
  if (pageContext) body.page_context = pageContext.slice(0, 200);
  if (input.dryRun === true) body.dry_run = true;

  let res: Response;
  try {
    res = await fetch(ESCALATE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "apikey": SERVICE_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { ok: false, error: "failed", message: `Couldn't reach the escalation service: ${e instanceof Error ? e.message : String(e)}` };
  }

  let json: Record<string, unknown>;
  try {
    json = asObj(JSON.parse(await res.text()));
  } catch {
    json = {};
  }

  if (json.ok === true) {
    // Tolerate a missing/unknown mode: infer from the urgency we sent.
    const mode: "tts_call" | "bridge" =
      json.mode === "bridge" ? "bridge"
      : json.mode === "tts_call" ? "tts_call"
      : urgency === "urgent" ? "bridge" : "tts_call";
    return { ok: true, mode };
  }

  const errCode = typeof json.error === "string" ? json.error : "";
  if (errCode === "cooldown") {
    const s = Number(json.retry_after_s);
    return { ok: false, error: "cooldown", retryAfterS: Number.isFinite(s) && s > 0 ? Math.round(s) : 0 };
  }
  if (errCode === "no_phone_on_file") {
    return { ok: false, error: "no_phone_on_file", hint: typeof json.hint === "string" && json.hint.trim() ? json.hint : null };
  }
  return { ok: false, error: "failed", message: errCode || `Escalation service error (${res.status}).` };
}
