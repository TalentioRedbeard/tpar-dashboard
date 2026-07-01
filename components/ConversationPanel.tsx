"use client";

// The talk-back loop UI. You talk out loud (the recorder up top captures); when you want a
// take, hit Respond → the `converse` edge fn reflects the point back sharper, asks the
// questions that move it forward, and captures anything worth keeping. It waits until you
// ask — no interrupting your processing pauses (v1 = user-cued turn-taking).

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { respond, type ConverseResult } from "@/app/conversation/converse-actions";

const initial: ConverseResult = { ok: null };

export function ConversationPanel({ recent }: { recent: string[] }) {
  const [state, formAction, pending] = useActionState(respond, initial);
  const router = useRouter();

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-navy-900">Conversation</h1>
        <p className="text-sm leading-relaxed text-navy-900/70">
          Talk it out — the recorder up top is already capturing. When you want a take, hit{" "}
          <span className="font-medium">Respond</span>: I&apos;ll reflect the point back sharper, ask what
          moves it forward, and log anything worth keeping. I wait until you ask — no interrupting the
          way you think.
        </p>
      </header>

      <section className="rounded-lg border border-navy-900/10 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-navy-900/50">
            The last ~20 min, out loud
          </h2>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="text-xs text-navy-900/50 transition hover:text-navy-900"
          >
            ↻ refresh
          </button>
        </div>
        {recent.length ? (
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1 text-sm text-navy-900/80">
            {recent.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-navy-900/50">Nothing transcribed yet — talk for a bit, then refresh.</p>
        )}
      </section>

      <form action={formAction}>
        <input type="hidden" name="since_minutes" value="15" />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-gold-500 px-5 py-2.5 text-sm font-semibold text-navy-900 shadow-sm transition hover:bg-gold-400 disabled:opacity-60"
        >
          {pending ? "Thinking…" : "Respond to what I've been saying"}
        </button>
      </form>

      {state.ok === false && (
        <p className="text-sm text-red-700">Couldn&apos;t respond: {state.message}</p>
      )}

      {state.ok === true && (
        <section className="space-y-4">
          <div className="rounded-lg border border-navy-900/10 bg-navy-900/[0.03] p-4">
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-navy-900">{state.reply}</p>
          </div>

          {state.questions.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-900/50">
                Questions that move it
              </h3>
              <ul className="space-y-2">
                {state.questions.map((q, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-navy-900/10 bg-white p-3 text-sm text-navy-900/90"
                  >
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.captured_tasks.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-900/50">
                Captured — nothing lost
              </h3>
              <ul className="space-y-2">
                {state.captured_tasks.map((t, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-gold-500/30 bg-gold-500/[0.06] p-3 text-sm"
                  >
                    <span className="font-semibold text-navy-900">{t.title}</span>
                    <span className="text-navy-900/70"> — {t.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
