"use server";

// Server action for the "Message the office" card on /me. Thin service-role
// bridge to the team-push edge fn (same lane as ask-escalate-actions): the fn
// owns the cooldown, recipient routing (office vs Danny), and the actual
// delivery — this action just gates (any signed-in session, same bar as the
// AskBar's action), attributes the actor from getCurrentTech(), and
// normalizes the contract's error shapes so the client renders exact states:
//
//   {ok:true, delivered?:...}
//   {ok:false, error:'cooldown'}
//   {ok:false, error}

import { supabaseServer } from "./supabase-server";
import { getCurrentTech } from "./current-tech";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEAM_PUSH_URL = `${SUPABASE_URL}/functions/v1/team-push`;

export type TeamPushRecipient = "office" | "danny";

// Discriminated on `error` so the client narrows cleanly:
//   "cooldown" → too many pushes in a row; the fn owns the window
//   "failed"   → generic; human message in `message`
export type TeamPushResult =
  | { ok: true }
  | { ok: false; error: "cooldown" }
  | { ok: false; error: "failed"; message: string };

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function pushTeamMessage(input: {
  to: TeamPushRecipient;
  text: string;
  pageContext?: string;
  dryRun?: boolean;
}): Promise<TeamPushResult> {
  const text = (input.text ?? "").trim().slice(0, 1000);
  if (!text) return { ok: false, error: "failed", message: "Nothing to send yet — write a quick note first." };
  // Never let a malformed client value change who receives the message.
  const to: TeamPushRecipient = input.to === "danny" ? "danny" : "office";

  // Same gate as the AskBar's own action: any signed-in user. The session
  // proves identity; the fn call itself rides the service key below.
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
  // to do with that.
  const me = await getCurrentTech().catch(() => null);
  if (!me) return { ok: false, error: "failed", message: "You're signed out — refresh and sign in." };
  const actor: Record<string, unknown> = {
    tech_short_name: me.tech?.tech_short_name || me.email,
  };
  if (me.tech?.tech_id) actor.tech_id = me.tech.tech_id;

  const body: Record<string, unknown> = { to, text, actor };
  const pageContext = (input.pageContext ?? "").trim();
  if (pageContext) body.page_context = pageContext.slice(0, 200);
  if (input.dryRun === true) body.dry_run = true;

  let res: Response;
  try {
    res = await fetch(TEAM_PUSH_URL, {
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
    return { ok: false, error: "failed", message: `Couldn't reach the messaging service: ${e instanceof Error ? e.message : String(e)}` };
  }

  let json: Record<string, unknown>;
  try {
    json = asObj(JSON.parse(await res.text()));
  } catch {
    json = {};
  }

  if (json.ok === true) return { ok: true };

  const errCode = typeof json.error === "string" ? json.error : "";
  if (errCode === "cooldown") return { ok: false, error: "cooldown" };
  return { ok: false, error: "failed", message: errCode || `Messaging service error (${res.status}).` };
}
