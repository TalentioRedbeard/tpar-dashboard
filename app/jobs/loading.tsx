// Shown by Next.js while /jobs is fetching — fixes the "I clicked Apply
// and nothing happened" feeling. The page does several DB queries
// (job_360 list + count, stats sample, tech_directory, optional HCP
// estimate-number live lookup) which can take 1-3s on a cold path.

import { PageShell } from "../../components/PageShell";

export default function JobsLoading() {
  return (
    <PageShell title="Jobs" description="Loading…">
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[68px] animate-pulse rounded-2xl border border-neutral-200 bg-neutral-100" />
        ))}
      </div>
      <div className="mb-5 h-14 animate-pulse rounded-2xl border border-neutral-200 bg-neutral-50" />
      <div className="rounded-2xl border border-neutral-200 bg-white">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="border-b border-neutral-100 px-4 py-3 last:border-0">
            <div className="flex items-center gap-3">
              <div className="h-3 w-16 animate-pulse rounded bg-neutral-200" />
              <div className="h-3 w-24 animate-pulse rounded bg-neutral-200" />
              <div className="h-3 w-40 animate-pulse rounded bg-neutral-200" />
              <div className="ml-auto h-3 w-16 animate-pulse rounded bg-neutral-200" />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-neutral-500">
        Searching… numbers from HCP estimate pages can take a few seconds while we cross-reference HCP.
      </p>
    </PageShell>
  );
}
