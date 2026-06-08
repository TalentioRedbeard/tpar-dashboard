"use client";

// App Router error boundary (covers /me and every other route). A transient
// render throw (Supabase auth blip, cookie read, cold-load network hiccup)
// would otherwise drop the tech onto Next's unstyled 500 with no way back.
// This renders inside the root layout, so Nav/branding stay intact.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-neutral-200 bg-white p-6 text-center">
      <h1 className="text-lg font-semibold text-neutral-900">
        Something hiccupped loading your day
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        Tap Try again. If it keeps happening, text Danny &mdash; don&apos;t
        restart anything, he&apos;ll know what went wrong.
      </p>
      <button
        onClick={() => reset()}
        className="mt-4 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Try again
      </button>
    </div>
  );
}
