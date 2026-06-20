// Branded, mobile-first public estimate render. Server component, NO client JS
// (v1 is read-only — view + track only, no approve/decline). Renders ONLY the
// whitelisted PublicEstimate from actions.ts: NEVER cost, margin, internal IDs,
// AI reasoning, or "Open in HCP". Uses the app brand tokens (globals.css).

import type { PublicEstimate, PublicOption } from "./actions";

function money(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function OptionCard({ opt, index }: { opt: PublicOption; index: number }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="text-base font-semibold text-neutral-900">
          {opt.name || `Option ${index + 1}`}
        </div>
        <div className="whitespace-nowrap text-lg font-bold text-brand-700">
          {money(opt.total_dollars)}
        </div>
      </div>

      {opt.lines.length > 0 ? (
        <ul className="mt-4 space-y-3 border-t border-neutral-100 pt-4">
          {opt.lines.map((l, i) => (
            <li key={i} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-neutral-800">{l.name}</span>
                {l.quantity != null && l.quantity !== 1 ? (
                  <span className="whitespace-nowrap text-xs text-neutral-500">×{l.quantity}</span>
                ) : null}
              </div>
              {l.description ? (
                <p className="mt-0.5 text-[13px] leading-relaxed text-neutral-500">{l.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : opt.description ? (
        <p className="mt-3 whitespace-pre-line border-t border-neutral-100 pt-3 text-sm leading-relaxed text-neutral-600">
          {opt.description}
        </p>
      ) : null}
    </div>
  );
}

export function PublicEstimateView({ estimate }: { estimate: PublicEstimate }) {
  const { customerName, estimateNumber, options, termsText } = estimate;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      {/* Header */}
      <header className="mb-6">
        <div className="text-xs font-bold uppercase tracking-wide text-brand-700">
          Tulsa Plumbing &amp; Remodeling
        </div>
        <h1 className="mt-1 text-2xl font-bold text-neutral-900">
          Your Estimate{estimateNumber ? ` #${estimateNumber}` : ""}
        </h1>
        {customerName ? (
          <p className="mt-1 text-sm text-neutral-600">Prepared for {customerName}</p>
        ) : null}
      </header>

      {/* Options */}
      {options.length > 0 ? (
        <div className="space-y-4">
          {options.map((opt, i) => (
            <OptionCard key={i} opt={opt} index={i} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
          The details of this estimate aren&rsquo;t available to view online. Please call or text us and
          we&rsquo;ll walk you through it.
        </div>
      )}

      {/* Terms / message from the pro */}
      {termsText ? (
        <div className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-neutral-600">{termsText}</p>
        </div>
      ) : null}

      {/* CTA — v1 is view-only: call/text, no approve/decline */}
      <div className="mt-6 rounded-2xl border border-brand-200 bg-brand-50 p-5 text-center">
        <p className="text-sm font-medium text-neutral-800">Questions about your estimate?</p>
        <p className="mt-1 text-sm text-neutral-600">
          Call or text us at{" "}
          <a href="tel:+19188004426" className="font-semibold text-brand-700 hover:underline">
            (918) 800-4426
          </a>
          .
        </p>
        <div className="mt-3 flex justify-center gap-3">
          <a
            href="tel:+19188004426"
            className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
          >
            Call us
          </a>
          <a
            href="sms:+19188004426"
            className="rounded-lg border border-brand-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Text us
          </a>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-8 text-center text-xs leading-relaxed text-neutral-400">
        Tulsa Plumbing &amp; Remodeling · tulsapar.com
        <br />
        This estimate is non-binding and reflects the scope discussed. Final pricing may adjust if
        conditions change.
      </footer>
    </main>
  );
}
