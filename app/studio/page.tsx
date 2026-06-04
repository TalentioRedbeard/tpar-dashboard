import { redirect } from "next/navigation";
import { PageShell } from "../../components/PageShell";
import { getCurrentTech } from "../../lib/current-tech";
import { searchCaptures } from "../../lib/studio-actions";
import { StudioStation } from "./StudioStation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Studio · Based on… · TPAR" };

// The "Based on…" station — search every capture in the system and build an
// estimate draft from any selection. Leadership-only (searches all comms).
export default async function StudioPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/studio");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  const initial = await searchCaptures("", "all");

  return (
    <PageShell
      kicker="Based on…"
      title="Studio"
      description="Search every capture — recordings, notes, calls/texts, photos — then build an estimate draft from any selection."
      help={{
        intent:
          "One place to dig up any recording, note, call/text, or photo and turn a selection into a priced estimate draft — with honest 'no data' flags when we're guessing.",
        actions: [
          "Search across everything; narrow by type with the chips.",
          "Tap a card to select it; ▶ plays a recording.",
          "Hit 'Build estimate from selected' to draft options from the lot.",
        ],
      }}
    >
      <StudioStation initial={initial} />
    </PageShell>
  );
}
