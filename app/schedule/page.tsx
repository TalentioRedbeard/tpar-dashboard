// /schedule — the full visual schedule page (day/week/month, filters, color modes).
//
// Auth + the tech-scoped fork live here; the interactive grid itself is the shared
// <ScheduleBoard> (chrome="full" here, chrome="compact" on /dispatch behind the
// Board/Map toggle). URL params still drive everything on the full page:
//   ?date=YYYY-MM-DD  ?view=day|week|month  ?color=status|tech|plaid
//   ?status=csv  ?tech=name  ?customer=text  ?revenue=1  ?action=1  ?include_test=1

import { redirect } from "next/navigation";
import { getCurrentTech } from "../../lib/current-tech";
import { TechScheduleView } from "./TechScheduleView";
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

  // Techs get a scoped "My schedule" — their OWN appointments only ("what pertains
  // to me") — instead of the leadership dispatch grid. Office users (signed in, no
  // tech row) still go to /me.
  if (!me.isAdmin && !me.isManager) {
    if (!me.tech) redirect("/me");
    return <TechScheduleView fullName={me.tech.hcp_full_name} shortName={me.tech.tech_short_name} centerKey={params.date} />;
  }

  return (
    <ScheduleBoard
      params={params}
      basePath="/schedule"
      isAdmin={me.isAdmin}
      canApply={me.isAdmin || me.isManager}
      chrome="full"
    />
  );
}
