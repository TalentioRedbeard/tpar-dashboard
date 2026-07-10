// Voice-ask leg 2: question -> ask-tpar with the CALLER's session JWT — the
// exact same role scoping as typed /ask (admin sees all, tech sees their lane)
// — then a spoken version via synthesize-speech. Voice is additive: TTS
// failure still returns the text answer. (Spoken answers land in the public
// content-addressed synthesized-speech bucket — same posture as the phone
// alerts and morning digest: unguessable hash URLs.)
import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// Slack-mrkdwn + emoji -> plain speakable text.
function speakable(text: string): string {
  return text
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<https?:\/\/[^>]+>/g, "")
    .replace(/[*_`]/g, "")
    .replace(/^\s*[•\-–]\s*/gm, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, 2400);
}

export async function POST(req: Request) {
  const supa = await supabaseServer();
  const { data: sessionData } = await supa.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? null;
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { question?: string } | null;
  const question = body?.question?.trim();
  if (!question) {
    return NextResponse.json({ ok: false, error: "no question" }, { status: 400 });
  }

  let answer = "";
  let intent: string | null = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ask-tpar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(80_000),
    });
    const j = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      answer?: string;
      intent?: string;
      error?: string;
    };
    if (!res.ok || !j.ok || !j.answer) {
      return NextResponse.json({ ok: false, error: j.error ?? `ask-tpar ${res.status}` }, { status: 502 });
    }
    answer = j.answer;
    intent = j.intent ?? null;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  let audioUrl: string | null = null;
  try {
    const sr = await fetch(`${SUPABASE_URL}/functions/v1/synthesize-speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify({ text: speakable(answer) }),
      signal: AbortSignal.timeout(30_000),
    });
    const sj = (await sr.json().catch(() => null)) as { ok?: boolean; url?: string } | null;
    if (sr.ok && sj?.ok && sj.url) audioUrl = sj.url;
  } catch {
    /* text-only fallback */
  }

  return NextResponse.json({ ok: true, answer, intent, audioUrl });
}
