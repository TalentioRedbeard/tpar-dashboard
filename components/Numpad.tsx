"use client";

// Numpad for sending keystrokes to the laptop via /snap Phase 2.
// Tap a key → server action → row in pending_input → poller SendKeys
// to focused window on laptop within ≤3s.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestKeystroke } from "@/app/snap/keys-actions";

const KEYPAD: Array<{ label: string; key: string; tone?: "neutral" | "brand" | "green" | "red" }> = [
  { label: "1", key: "1", tone: "brand"   },  // typically "yes/approve" in Claude Code prompts
  { label: "2", key: "2", tone: "neutral" },
  { label: "3", key: "3", tone: "neutral" },
  { label: "4", key: "4", tone: "neutral" },
  { label: "5", key: "5", tone: "neutral" },
  { label: "6", key: "6", tone: "neutral" },
  { label: "7", key: "7", tone: "neutral" },
  { label: "8", key: "8", tone: "neutral" },
  { label: "9", key: "9", tone: "neutral" },
  { label: "Esc", key: "{ESC}", tone: "red" },
  { label: "0", key: "0", tone: "neutral" },
  { label: "Enter", key: "{ENTER}", tone: "green" },
];

const TONE_CLS: Record<string, string> = {
  neutral: "bg-white text-neutral-900 border-neutral-300 hover:bg-neutral-50 active:bg-neutral-100",
  brand:   "bg-brand-700 text-white border-brand-700 hover:bg-brand-800 active:bg-brand-900",
  green:   "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 active:bg-emerald-800",
  red:     "bg-red-600 text-white border-red-600 hover:bg-red-700 active:bg-red-800",
};

export function Numpad() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);

  function press(key: string, label: string) {
    setError(null);
    setPendingKey(key);
    startTransition(async () => {
      const r = await requestKeystroke({ key });
      setPendingKey(null);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setLastSent(label);
      // Auto-clear after 3s so the UI doesn't stay stuck on a green confirm
      setTimeout(() => setLastSent(null), 3000);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-3 text-center text-xs text-neutral-600">
        <strong>Focus your laptop&apos;s Claude Code window first</strong>, then tap a key.
        Poller delivers within ≤3 seconds.
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-center text-xs text-red-800">
          {error}
        </div>
      )}
      {lastSent && !error && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-center text-xs text-emerald-800">
          Sent: <span className="font-mono font-semibold">{lastSent}</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {KEYPAD.map(({ label, key, tone }) => {
          const cls = TONE_CLS[tone ?? "neutral"];
          const isThisPending = pendingKey === key;
          return (
            <button
              key={key}
              type="button"
              disabled={pending}
              onClick={() => press(key, label)}
              className={
                "h-16 rounded-2xl border-2 text-xl font-semibold shadow-sm transition active:scale-95 disabled:opacity-40 " +
                cls
              }
            >
              {isThisPending ? "…" : label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 text-center text-[11px] text-neutral-500">
        1/Enter are styled for the common Claude Code prompt: 1 = approve · Enter = confirm · Esc = abort
      </div>
    </div>
  );
}
