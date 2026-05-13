// Root-level loading state — shown by Next.js when no route-segment-specific
// loading.tsx is found. Catch-all so no page ever loads silently.

import { PageLoading } from "../components/Spinner";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <PageLoading label="Loading…" />
    </div>
  );
}
