// /photos — web upload flow for job photos + videos.

import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { getRecentJobs } from "./actions";
import { PhotoForm } from "./PhotoForm";
import { getCurrentState as getClockState, type CurrentClockState } from "../time/actions";

export const dynamic = "force-dynamic";

export default async function PhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/photos");

  const params = await searchParams;
  const recentJobs = await getRecentJobs({ limit: 30 });
  const clockState = me.tech ? await getClockState().catch(() => null) : null;
  const clockedJobId = clockState && clockState.state === "clocked-in"
    ? (clockState as Extract<CurrentClockState, { state: "clocked-in" }>).hcp_job_id
    : null;

  // Default to query-param job, else current clocked-in job, else first recent job
  const defaultJobId = params.job ?? clockedJobId ?? recentJobs[0]?.hcp_job_id ?? "";

  return (
    <PageShell
      kicker="Photos"
      title="Add a photo"
      description="Snap or pick a photo and tag it to a job. The photo lives in TPAR storage + on the job's record."
    >
      <PhotoForm
        canWrite={me.canWrite}
        recentJobs={recentJobs}
        defaultJobId={defaultJobId}
        clockedJobId={clockedJobId}
      />
    </PageShell>
  );
}
