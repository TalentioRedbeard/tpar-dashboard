"use client";

// Install banner for the PWA. Two paths:
//   Android / Chromium → uses `beforeinstallprompt` event API for one-tap install
//   iOS Safari        → shows a small custom CTA ("Tap Share → Add to Home Screen")
//                       since iOS has no programmatic install
//
// Dismissal persists in localStorage so the prompt doesn't nag.

import { useEffect, useState } from "react";

const DISMISS_KEY = "tpar-install-dismissed";
const DISMISS_DAYS = 14;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS
  if ("standalone" in navigator && (navigator as unknown as { standalone?: boolean }).standalone) return true;
  // Android / Chromium
  return window.matchMedia("(display-mode: standalone)").matches;
}

function isiOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
}

function recentlyDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(DISMISS_KEY);
    if (!v) return false;
    const ts = Number(v);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_DAYS * 86400_000;
  } catch {
    return false;
  }
}

function rememberDismiss() {
  try { window.localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ok */ }
}

export function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [iosMode, setIosMode] = useState(false);
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone()) return;          // already installed
    if (recentlyDismissed()) return;

    // Path A: Android / Chromium — listen for the install event
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler as EventListener);

    // Path B: iOS Safari — show after a short delay if no native prompt fired
    if (isiOS()) {
      const t = setTimeout(() => {
        setIosMode(true);
        setShow(true);
      }, 1500);
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", handler as EventListener);
      };
    }

    return () => window.removeEventListener("beforeinstallprompt", handler as EventListener);
  }, []);

  if (!show) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 sm:left-auto sm:right-3 sm:max-w-sm">
      <div className="overflow-hidden rounded-2xl border border-brand-200 bg-white p-4 shadow-lg">
        <div className="flex gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white">
            <span className="text-lg font-extrabold tracking-tight">T</span>
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-neutral-900">Install TPAR</div>
            {iosMode ? (
              <div className="mt-1 text-xs leading-snug text-neutral-600">
                <p>iOS doesn&apos;t let websites install themselves — Apple makes it two taps in Safari:</p>
                <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
                  <li>
                    Tap Safari&apos;s <span className="font-semibold">Share</span> button — the square-with-arrow icon at the <span className="font-semibold">bottom of your screen</span> (middle of Safari&apos;s toolbar).
                  </li>
                  <li>
                    Scroll down → tap <span className="font-semibold">&ldquo;Add to Home Screen.&rdquo;</span>
                  </li>
                </ol>
                <p className="mt-1.5 text-neutral-500">After that, TPAR opens from your home screen like a real app — no Safari address bar.</p>
              </div>
            ) : (
              <div className="mt-1 text-xs leading-snug text-neutral-600">
                Add the dashboard to your home screen so clock-in is one tap.
              </div>
            )}
            <div className="mt-2.5 flex items-center gap-2">
              {!iosMode && deferredEvent ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await deferredEvent.prompt();
                      const choice = await deferredEvent.userChoice;
                      if (choice.outcome === "accepted" || choice.outcome === "dismissed") {
                        rememberDismiss();
                        setShow(false);
                      }
                    } catch {
                      rememberDismiss();
                      setShow(false);
                    }
                  }}
                  className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
                >
                  Install
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  rememberDismiss();
                  setShow(false);
                }}
                className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
