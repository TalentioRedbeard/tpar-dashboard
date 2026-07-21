import { redirect } from "next/navigation";
import { PageShell } from "../../components/PageShell";
import { getCurrentTech } from "../../lib/current-tech";
import { searchCaptures } from "../../lib/studio-actions";
import { listMyStudioCaptures } from "../../lib/recordings";
import { StudioStation } from "./StudioStation";
import { TechStudio } from "../../components/TechStudio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Studio · TPAR" };

// Studio has two faces (Danny 2026-07-21):
//  • Leadership (admin|manager) → the "Based on…" station: search EVERY capture in
//    the system + build an estimate draft. Reads all-company data — leadership-only.
//  • Technician → their OWN recording hub (creator-scoped Inbox/Filed). Uses its
//    own scoped action (listMyStudioCaptures on created_by_uid) — it must NOT reuse
//    the leadership search, which would breach tech scoped-visibility.
export default async function StudioPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/studio");

  if (me.isAdmin || me.isManager) {
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

  // Technician hub — creator-scoped.
  const { inbox, filed } = await listMyStudioCaptures();
  return (
    <PageShell
      kicker="Studio"
      title="Your recordings"
      description="Every voice note you've made — record new ones, play them back, file them to a job/customer/estimate, or turn one into an estimate."
      help={{
        intent: "Your recording hub — nothing you record gets lost. Inbox = not filed yet (clears after 3 days). Filed = attached to work and kept.",
        actions: [
          "Record a new capture up top — it lands in your Inbox.",
          "File an Inbox capture to a job so it's kept, or Remove it.",
          "Play any capture; turn a customer one into an estimate.",
        ],
      }}
    >
      <TechStudio inbox={inbox} filed={filed} />
    </PageShell>
  );
}
