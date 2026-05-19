// /notes/new — log a note to management.
//
// Backed by tech_voice_notes with intent_tag='management_note' + needs_discussion=true.
// Routes through the existing leadership-extension flow (lands in /admin/concerns).
// Always pings Danny via notify-danny so he sees it on his phone.

import { redirect } from "next/navigation";
import { PageShell } from "../../../components/PageShell";
import { getCurrentTech } from "../../../lib/current-tech";
import { NoteForm } from "./NoteForm";

export const metadata = { title: "Note to mgmt · TPAR-DB" };
export const dynamic = "force-dynamic";

export default async function NewNotePage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; customer?: string; body?: string; urgent?: string }>;
}) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/notes/new");

  const sp = await searchParams;

  return (
    <PageShell
      title="Note to management"
      description="Logs to /admin/concerns + DMs Danny on Slack."
      help={{
        intent: "Drop a note for Danny when something needs his attention but isn't an emergency. Goes to /admin/concerns queue + pings him on Slack.",
        actions: [
          "Write what you'd say if you walked into Danny's office. Be specific.",
          "Tags (optional, comma-separated): scheduling, employee, customer, system, vendor, training, etc.",
          "Mark urgent if it can't wait until tomorrow.",
          "Attach a job or customer (optional) via the link in the URL — e.g. /notes/new?job=job_xxx",
        ],
        stuck: <>True emergency? Call Danny direct. This is for next-business-hours discussion.</>,
      }}
    >
      <NoteForm
        defaultBody={sp.body ?? ""}
        defaultUrgent={sp.urgent === "1"}
        hcpJobId={sp.job ?? null}
        hcpCustomerId={sp.customer ?? null}
        signedInAs={me.tech?.tech_short_name ?? me.email}
      />
    </PageShell>
  );
}
