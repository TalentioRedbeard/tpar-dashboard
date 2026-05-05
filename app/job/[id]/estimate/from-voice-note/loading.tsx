// Shown during the from-voice-note page render. The first phase (picker)
// is fast; the second phase runs the Claude generator (~30-45s for full
// option set, ~10-25s for single line item). Without this, the user sees
// a blank page for that whole window.

import { PageShell } from "../../../../../components/PageShell";

export default function FromVoiceNoteLoading() {
  return (
    <PageShell title="Estimate from voice note" description="Loading…">
      <div className="space-y-4">
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm">
          <div className="flex items-center gap-3">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-600" aria-hidden />
            <div className="flex-1">
              <div className="font-semibold text-brand-900">Generating from voice note…</div>
              <div className="mt-0.5 text-xs text-brand-700">
                Claude is reading the transcript + job context + estimating knowledge → producing structured options. Typically 10-45 seconds. The EstimateBuilder will load pre-populated when this finishes.
              </div>
            </div>
          </div>
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="mb-3 h-4 w-48 animate-pulse rounded bg-neutral-200" />
            <div className="space-y-2">
              <div className="h-12 animate-pulse rounded bg-neutral-100" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-100" />
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
