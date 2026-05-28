// Presentational card for a team note (whiteboard post or inbox item).
// Server component — pure display.

import Link from "next/link";
import type { BoardNote } from "../app/notes/board-actions";

function fmtChi(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function attachHref(kind: BoardNote["attach_kind"], ref: string): string | null {
  if (kind === "job") return `/job/${ref}`;
  if (kind === "customer") return `/customer/${ref}`;
  if (kind === "url") return ref;
  return null;
}

export function NoteCard({ note, unread = false }: { note: BoardNote; unread?: boolean }) {
  const href = note.attach_kind && note.attach_ref ? attachHref(note.attach_kind, note.attach_ref) : null;
  const external = note.attach_kind === "url";
  return (
    <div className={`rounded-xl border bg-white p-4 ${unread ? "border-brand-300 ring-1 ring-brand-100" : "border-neutral-200"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-neutral-500">
        <span>
          <span className="font-medium text-neutral-800">{note.author_short_name ?? note.author_email}</span>
          {note.target_kind === "teammate" && note.target_short_name ? (
            <span> → {note.target_short_name}</span>
          ) : null}
        </span>
        <span className="flex items-center gap-2">
          {note.urgent ? <span className="rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700">URGENT</span> : null}
          {unread ? <span className="rounded bg-brand-100 px-1.5 py-0.5 font-semibold text-brand-700">NEW</span> : null}
          {fmtChi(note.created_at)}
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">{note.body}</p>

      {(note.tags?.length ?? 0) > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {note.tags.map((t) => (
            <span key={t} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">{t}</span>
          ))}
        </div>
      ) : null}

      {note.attach_kind && note.attach_ref ? (
        <div className="mt-2 text-xs">
          {href ? (
            external ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 underline">
                {note.attach_kind}: {note.attach_ref}
              </a>
            ) : (
              <Link href={href} className="font-medium text-brand-700 underline">
                {note.attach_kind}: {note.attach_ref}
              </Link>
            )
          ) : (
            <span className="text-neutral-500">{note.attach_kind}: {note.attach_ref}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
