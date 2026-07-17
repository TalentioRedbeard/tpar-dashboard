// /schedule — the full visual schedule board (day/week/month, filters, colors).
//
// Office (admin/manager) get the board with write affordances (drag writes to
// HCP, create job/event). A field tech gets the SAME board in read-only tech mode
// (Danny 2026-07-17): they SEE the whole company schedule, but drag becomes an
// office-approval REQUEST, revenue shows only on their own jobs, create is
// estimate-only, and reorder/apply are hidden. The interactive grid is the shared
// <ScheduleBoard> (chrome="full" here, chrome="compact" on /dispatch).

import { redirect } from "next/navigation";
import { getCurrentTech } from "../../lib/current-tech";
import { ScheduleBoard } from "../../components/ScheduleBoard";

export const metadata = { title: "Schedule · TPAR-DB" };
export const dynamic = "force-dynamic";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/schedule");
  const params = await searchParams;

  const isOffice = me.isAdmin || me.isManager;
  // A signed-in office user with no tech row and no leadership role has no place
  // on the board — send them to /me (unchanged behavior).
  if (!isOffice && !me.tech) redirect("/me");

  return (
    <ScheduleBoard
      params={params}
      basePath="/schedule"
      isAdmin={me.isAdmin}
      canApply={isOffice}
      chrome="full"
      mode={isOffice ? "office" : "tech"}
      viewerEmpId={me.tech?.hcp_employee_id ?? null}
      canSeeAllMoney={isOffice}
    />
  );
}
