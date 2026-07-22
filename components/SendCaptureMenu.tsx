"use client";

// "Send…" on a capture — DM or email it to a teammate (Studio Send-UI). Lazy-loads
// the roster on first open; the send action scopes the capture to its owner and only
// ever targets an internal teammate (resolved server-side from tech_id).

import { useState, useTransition } from "react";
import { getSendableTeammates, sendCaptureToTeammate, type SendableTeammate } from "../lib/capture-send-actions";

export function SendCaptureMenu({ recordingId }: { recordingId: string }) {
  const [open, setOpen] = useState(false);
  const [mates, setMates] = useState<SendableTeammate[] | null>(null);
  const [pick, setPick] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function openMenu() {
    setMsg(null);
    setOpen(true);
    if (!mates) {
      try {
        const list = await getSendableTeammates();
        setMates(list);
        if (list.length) setPick(list[0].tech_id);
      } catch {
        // Surface the failure (matches the {ok,error}→msg convention) instead of
        // dead-ending the picker on "loading…"; reopen retries.
        setMsg({ ok: false, text: "Couldn't load teammates — try again." });
        setOpen(false);
      }
    }
  }
  const selected = mates?.find((m) => m.tech_id === pick) ?? null;

  function send(channel: "slack" | "email") {
    if (!pick) return;
    setMsg(null);
    start(async () => {
      const r = await sendCaptureToTeammate({ recordingId, teammateTechId: pick, channel });
      if (r.ok) { setMsg({ ok: true, text: `Sent to ${selected?.label ?? "teammate"} ✓` }); setOpen(false); }
      else setMsg({ ok: false, text: r.error ?? "Send failed" });
    });
  }

  return (
    <>
      {!open ? (
        <button type="button" onClick={openMenu}
          className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100">
          Send…
        </button>
      ) : (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={pending || !mates}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs">
            {!mates ? <option>loading…</option>
              : mates.length ? mates.map((m) => <option key={m.tech_id} value={m.tech_id}>{m.label}</option>)
              : <option value="">no teammates</option>}
          </select>
          <button type="button" disabled={pending || !selected?.hasSlack} onClick={() => send("slack")}
            title={selected?.hasSlack ? "Slack DM" : "no Slack linked"}
            className="rounded-md bg-brand-700 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-40">
            💬 Slack
          </button>
          <button type="button" disabled={pending || !selected?.hasEmail} onClick={() => send("email")}
            title={selected?.hasEmail ? "Email" : "no email on file"}
            className="rounded-md bg-brand-700 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-40">
            📧 Email
          </button>
          <button type="button" onClick={() => setOpen(false)} disabled={pending} className="text-xs text-neutral-500 hover:underline">cancel</button>
        </span>
      )}
      {msg ? <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span> : null}
    </>
  );
}
