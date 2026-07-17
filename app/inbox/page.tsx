// /inbox — notes other people sent directly to you, plus a composer to send a
// note to a teammate. Part of the unified team-notes capture.

import Link from "next/link";
import { PageShell } from "../../components/PageShell";
import { NoteComposer } from "../../components/NoteComposer";
import { NoteCard } from "../../components/NoteCard";
import { MarkReadButton } from "../../components/MarkReadButton";
import { listMyInbox, listRecipients } from "../notes/board-actions";
import { getCurrentTech } from "../../lib/current-tech";

export const metadata = { title: "Inbox · TPAR-DB" };
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const [me, notes, recipients] = await Promise.all([
    getCurrentTech().catch(() => null),
    listMyInbox(),
    listRecipients(),
  ]);
  const signedInAs = me?.tech?.tech_short_name ?? me?.email ?? null;
  const unreadCount = notes.filter((n) => !n.read_at).length;

  return (
    <PageShell
      kicker="Notes"
      title="Inbox"
      description={unreadCount > 0 ? `${unreadCount} new note${unreadCount === 1 ? "" : "s"} for you.` : "Notes sent directly to you."}
      help={{
        intent: "Notes teammates sent directly to you, and a place to send one back.",
        actions: ["Read a note, then hit Mark read", "Send a note to anyone on the team with the box up top", "Attach a job or estimate if it's about a specific one"],
      }}
    >
      {/* SMS preferences moved to /settings (hygiene, spec §1): the old inline
          toggle wrote tech_directory by email-ilike with no self gate — under
          view-as it silently edited the WRONG row. One settings surface now. */}
      <p className="mb-4 text-xs text-neutral-500">
        Note texts and every other notification preference live in{" "}
        <Link href="/settings" className="underline hover:text-neutral-700">Settings</Link>.
      </p>

      <div className="mb-6">
        <NoteComposer mode="teammate" recipients={recipients} signedInAs={signedInAs} />
      </div>

      {notes.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">
          No notes yet.
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="flex items-start gap-2">
              <div className="flex-1">
                <NoteCard note={n} unread={!n.read_at} />
              </div>
              {!n.read_at ? <div className="pt-1"><MarkReadButton id={n.id} /></div> : null}
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
