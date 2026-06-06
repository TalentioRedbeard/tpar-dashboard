// WhiteboardPanel — compact read view of the company whiteboard, surfaced on
// /me so daily team postings land on everybody's dashboard (Danny 2026-06-05).
// Reuses the existing team-notes board (app/notes/board-actions) + the NoteCard
// renderer + the /whiteboard page for posting — no new backend. Urgent posts
// float to the top; bounded-scroll per the panel rule (feedback_bounded_scroll_
// panels_2026-06-01). Landing on /me marks the board seen since it's shown here.

import Link from "next/link";
import { listWhiteboard } from "../app/notes/board-actions";
import { NoteCard } from "./NoteCard";
import { MarkWhiteboardSeen } from "./MarkWhiteboardSeen";
import { ScrollPanel } from "./ui/ScrollPanel";

export async function WhiteboardPanel() {
  const notes = await listWhiteboard(12).catch(() => []);
  // urgent first; listWhiteboard already returns newest-first, and JS sort is
  // stable, so equal-urgency posts keep their newest-first order.
  const ordered = [...notes].sort((a, b) => Number(b.urgent) - Number(a.urgent));

  return (
    <section className="mb-8">
      <MarkWhiteboardSeen />
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-700">📋 Team whiteboard</h2>
        <Link href="/whiteboard" className="text-xs font-medium text-brand-700 hover:underline">
          {ordered.length ? "Open board / post →" : "Post to the board →"}
        </Link>
      </div>
      {ordered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-4 text-center text-xs text-neutral-500">
          Nothing on the board yet — <Link href="/whiteboard" className="font-medium text-brand-700 underline">post the first note</Link>.
        </div>
      ) : (
        <ScrollPanel tier="standard">
          <div className="space-y-2">
            {ordered.map((n) => <NoteCard key={n.id} note={n} />)}
          </div>
        </ScrollPanel>
      )}
    </section>
  );
}
