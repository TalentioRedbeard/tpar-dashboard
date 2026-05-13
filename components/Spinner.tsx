// Spinner.tsx — reusable loading indicator.
//
// Tailwind-only animation, no JS. Comes in two flavors:
//   <Spinner />       — small inline spinner (16px), aligns next to text
//   <PageLoading />   — full-page card with brand-colored spinner + label
//
// Used by Next.js loading.tsx files at route segments to give techs visible
// feedback during slow page loads. Per Danny 2026-05-13: "really help how
// slow this website is" — the page is loading, it just doesn't *say* it is.

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={["h-4 w-4 animate-spin text-brand-700", className].filter(Boolean).join(" ")}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export function PageLoading({ label = "Loading…", subtitle }: { label?: string; subtitle?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-2xl border border-neutral-200 bg-white p-8 text-center">
      <div className="relative h-12 w-12">
        <div className="absolute inset-0 animate-ping rounded-full bg-brand-200 opacity-40" />
        <div className="absolute inset-2 animate-spin rounded-full border-4 border-brand-200 border-t-brand-700" />
      </div>
      <p className="text-sm font-medium text-neutral-800" role="status" aria-live="polite">{label}</p>
      {subtitle ? <p className="text-xs text-neutral-500">{subtitle}</p> : null}
    </div>
  );
}
