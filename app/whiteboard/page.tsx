// /whiteboard — company-wide open feed. Anyone signed in can post + read.
// Part of the unified team-notes capture (see app/notes/board-actions.ts).

import { PageShell } from "../../components/PageShell";
import { NoteComposer } from "../../components/NoteComposer";
import { NoteCard } from "../../components/NoteCard";
import { listWhiteboard } from "../notes/board-actions";
import { getCurrentTech } from "../../lib/current-tech";

export const metadata = { title: "Whiteboard · TPAR-DB" };
export const dynamic = "force-dynamic";

export default async function WhiteboardPage() {
  const [me, notes] = await Promise.all([
    getCurrentTech().catch(() => null),
    listWhiteboard(50),
  ]);
  const signedInAs = me?.tech?.tech_short_name ?? me?.email ?? null;

  return (
    <PageShell
      kicker="Company"
      title="Whiteboard"
      description="Open board for the whole company — questions, heads-ups, wins, ideas. Everyone can see and post."
      help={{
        intent: "A shared board for the whole company. Post anything the team should see — a question, a heads-up, a win.",
        actions: ["Type in the box and hit Post", "Add tags so it's easy to find later", "Attach a job or link if it's about something specific"],
      }}
    >
      <div className="mb-6">
        <NoteComposer mode="whiteboard" signedInAs={signedInAs} />
      </div>

      {notes.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">
          Nothing on the board yet — be the first to post.
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => <NoteCard key={n.id} note={n} />)}
        </div>
      )}
    </PageShell>
  );
}
