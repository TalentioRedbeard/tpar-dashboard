// /find — "What job(s) are you looking for?" entry point.
//
// Free-text + voice resolver biased by GPS / today / recent comms.
// Top candidate gets action buttons (Estimate, Receipt, Photo, Voice
// note, Open job). The "behavior manager" piece surfaces nudges per
// candidate ("you haven't hit Start yet").

import { redirect } from "next/navigation";
import { PageShell } from "../../components/PageShell";
import { JobFinder } from "../../components/JobFinder";
import { getCurrentTech } from "../../lib/current-tech";

export const metadata = { title: "Find a job · TPAR-DB" };
export const dynamic = "force-dynamic";

export default async function FindPage({ searchParams }: { searchParams: Promise<{ q?: string; action?: string }> }) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/find");

  const { q, action } = await searchParams;
  const initialQuery = (q ?? "").trim();

  // If a specific action was requested via ?action=, narrow the action set.
  const validActions = ["estimate", "receipt", "photo", "voice", "open"] as const;
  type Action = (typeof validActions)[number];
  const actions: Action[] = action && validActions.includes(action as Action)
    ? [action as Action, "open"]
    : ["estimate", "receipt", "photo", "voice", "open"];

  return (
    <PageShell
      title="Find a job"
      description={action ? `Pick the job you want to start a ${action} on.` : "Type, talk, or just look at what's near you."}
      backHref="/me"
      backLabel="My day"
      help={{
        intent: "Tell the system what you're looking for — by name, address, or just leave it empty for today's schedule. It uses your van GPS + your schedule + recent calls to put the right job at the top.",
        actions: [
          "Type a customer name or street — it filters live.",
          "Tap 🎙 to say it instead of type.",
          "Leave empty and the system shows today's jobs sorted by what's most likely current.",
          "Each candidate shows nudges — \"you haven't hit Start\" — read them.",
          "Click an action button on the top result to jump to that page with the job pre-filled.",
        ],
        stuck: <>System can&apos;t find the customer? Search by street instead. Or open <a href="/jobs" className="underline">/jobs</a> and scroll.</>,
      }}
    >
      <JobFinder initialQuery={initialQuery} actions={actions} />
    </PageShell>
  );
}
