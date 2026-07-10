// Voice-ask leg 1 (Hey-TPAR rung 1): browser audio -> on-prem whisper.
// Audio goes ONLY to our VM (faster-whisper large-v3 behind the token-gated
// Tailscale Funnel gateway — /transcribe route added 2026-07-10); it never
// touches a cloud STT API. Also returns the cached "let me look that up" ack
// audio URL so the client can bridge answer latency (the two-speed
// conversation pattern — synthesize-speech is content-addressed, so the ack
// is one ElevenLabs charge ever).
import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import { db } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const ACK_TEXT = "Let me look that up — give me just a minute. Shouldn't take long.";

async function gatewayCfg(): Promise<{ base: string; token: string } | null> {
  const { data } = await db()
    .from("llm_gateway_config")
    .select("base_url, api_key")
    .limit(1)
    .maybeSingle();
  const base = (data?.base_url as string | undefined)?.replace(/\/v1\/?$/, "");
  const token = data?.api_key as string | undefined;
  return base && token ? { base, token } : null;
}

async function ackUrl(): Promise<string | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/synthesize-speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify({ text: ACK_TEXT }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; url?: string } | null;
    return r.ok && j?.ok && j.url ? j.url : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const supa = await supabaseServer();
  const { data: sessionData } = await supa.auth.getSession();
  if (!sessionData.session) {
    return NextResponse.json({ ok: false, error: "not signed in" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "no audio" }, { status: 400 });
  }
  if (file.size > 4_000_000) {
    return NextResponse.json({ ok: false, error: "clip too long — keep it under 30 seconds" }, { status: 413 });
  }

  const cfg = await gatewayCfg();
  if (!cfg) {
    return NextResponse.json({ ok: false, error: "voice gateway not configured" }, { status: 503 });
  }

  const fd = new FormData();
  fd.append("file", file, file.name || "voice-ask.webm");
  fd.append(
    "initial_prompt",
    "A spoken question to the TPAR assistant at a plumbing and remodeling company. Customer names, technician names, jobs, estimates, schedule.",
  );

  try {
    const [tr, ack] = await Promise.all([
      fetch(`${cfg.base}/transcribe`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.token}` },
        body: fd,
        signal: AbortSignal.timeout(45_000),
      }),
      ackUrl(),
    ]);
    const j = (await tr.json().catch(() => null)) as { ok?: boolean; text?: string } | null;
    if (!tr.ok || !j?.ok) {
      return NextResponse.json({ ok: false, error: `transcribe ${tr.status}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, transcript: (j.text ?? "").trim(), ackUrl: ack });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
