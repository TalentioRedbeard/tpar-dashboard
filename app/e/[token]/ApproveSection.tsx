"use client";

// Per-option Approve control for the hosted estimate view. Two taps: Approve →
// inline confirm naming the option and price → done state. The token is the
// only key the client holds; the server action re-validates it like the page
// read. One approval per estimate — after any option is approved the page
// shows the banner instead of buttons.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveEstimateOption } from "./actions";

function money(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "";
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

export function ApproveButton({
  token,
  optionIdx,
  optionName,
  totalDollars,
}: {
  token: string;
  optionIdx: number;
  optionName: string;
  totalDollars: number | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function approve() {
    if (pending) return;
    start(async () => {
      const r = await approveEstimateOption(token, optionIdx);
      if (r.ok) {
        setDone(r.optionName ?? optionName);
        // Re-render the page so the approved banner replaces every button.
        setTimeout(() => router.refresh(), 1600);
      } else {
        setFailed(true);
      }
    });
  }

  if (done) {
    return (
      <div className="mt-4 rounded-lg bg-emerald-50 px-4 py-2.5 text-center text-sm font-semibold text-emerald-800">
        ✓ Approved — we&rsquo;ll reach out to get you scheduled.
      </div>
    );
  }
  if (failed) {
    return (
      <div className="mt-4 rounded-lg bg-neutral-100 px-4 py-2.5 text-center text-sm text-neutral-700">
        That didn&rsquo;t go through — please call or text us at{" "}
        <a href="tel:+19188004426" className="font-semibold text-brand-700">(918) 800-4426</a> and
        we&rsquo;ll take care of it.
      </div>
    );
  }

  return (
    <div className="mt-4">
      {confirming ? (
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-center">
          <button
            type="button"
            onClick={approve}
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? "Sending…" : `Yes — approve ${optionName}${totalDollars != null ? ` for ${money(totalDollars)}` : ""}`}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-neutral-500 hover:text-neutral-700"
          >
            Not yet
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="w-full rounded-lg border-2 border-emerald-600 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 transition hover:bg-emerald-50"
        >
          ✓ Approve this option
        </button>
      )}
    </div>
  );
}

export function ApprovedBanner({ optionName, approvedAtISO }: { optionName: string | null; approvedAtISO: string }) {
  const when = new Date(approvedAtISO).toLocaleDateString("en-US", {
    timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric",
  });
  return (
    <div className="mb-6 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5 text-center">
      <p className="text-base font-bold text-emerald-800">
        ✓ Approved{optionName ? ` — ${optionName}` : ""}
      </p>
      <p className="mt-1 text-sm text-emerald-700">
        On {when}. We&rsquo;ll reach out to get you scheduled — or call us any time at{" "}
        <a href="tel:+19188004426" className="font-semibold underline">(918) 800-4426</a>.
      </p>
    </div>
  );
}
