"use client";

// Customer-page email surface. Owner-only: browse/search the owner's inbox for
// emails matched to this customer and pin the relevant ones with a visibility
// level + handling note. Everyone (per visibility) sees the pinned list. After
// any mutation we router.refresh() to re-pull the server-rendered pinned list.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  listInboxMatches, pinEmail, updatePin, unpinEmail,
  type InboxMatch, type PinnedEmail, type Visibility,
} from "../app/customer/[id]/email-actions";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
}

const VIS_LABEL: Record<Visibility, string> = { tech: "Shared with tech", leadership: "Leadership only" };

export function CustomerEmails({ hcpCustomerId, isOwner, pinned }: { hcpCustomerId: string; isOwner: boolean; pinned: PinnedEmail[] }) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      {pinned.length > 0 ? (
        <ul className="space-y-2">
          {pinned.map((p) => (
            <PinnedRow key={p.pinId} pin={p} hcpCustomerId={hcpCustomerId} isOwner={isOwner} onChange={() => router.refresh()} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-500">No emails pinned to this customer yet.</p>
      )}

      {isOwner ? <InboxPanel hcpCustomerId={hcpCustomerId} pinnedEmailIds={new Set(pinned.map((p) => p.emailId))} onChange={() => router.refresh()} /> : null}
    </div>
  );
}

function PinnedRow({ pin, hcpCustomerId, isOwner, onChange }: { pin: PinnedEmail; hcpCustomerId: string; isOwner: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [vis, setVis] = useState<Visibility>(pin.visibility);
  const [note, setNote] = useState(pin.handlingNote ?? "");
  const [pending, start] = useTransition();

  return (
    <li className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-neutral-900">{pin.subject ?? "(no subject)"}</span>
        <span className="flex items-center gap-2 text-xs text-neutral-500">
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${pin.visibility === "tech" ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200 text-neutral-700"}`}>
            {VIS_LABEL[pin.visibility]}
          </span>
          {fmtDate(pin.receivedAt)}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-neutral-500">{pin.fromName ?? pin.fromAddress ?? "—"}</div>
      {pin.aiSummary ? <p className="mt-1 text-xs text-neutral-700">{pin.aiSummary}</p> : null}
      {pin.handlingNote ? (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900"><span className="font-semibold">Handle:</span> {pin.handlingNote}</p>
      ) : null}

      {isOwner ? (
        <div className="mt-2">
          {editing ? (
            <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
              <select value={vis} onChange={(e) => setVis(e.target.value as Visibility)} className="rounded-md border border-neutral-300 px-2 py-1 text-xs">
                <option value="tech">Shared with assigned tech</option>
                <option value="leadership">Leadership only</option>
              </select>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="How should this be treated?" className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs" />
              <div className="flex gap-2">
                <button type="button" disabled={pending} onClick={() => start(async () => { const r = await updatePin({ pinId: pin.pinId, hcpCustomerId, visibility: vis, handlingNote: note }); if (r.ok) { setEditing(false); onChange(); } })} className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
                <button type="button" onClick={() => setEditing(false)} className="px-2 py-1 text-xs text-neutral-600">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3 text-xs">
              <button type="button" onClick={() => setEditing(true)} className="font-medium text-brand-700 hover:text-brand-900">Edit</button>
              <button type="button" disabled={pending} onClick={() => start(async () => { const r = await unpinEmail(pin.pinId, hcpCustomerId); if (r.ok) onChange(); })} className="text-neutral-500 hover:text-red-700 disabled:opacity-50">Unpin</button>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

function InboxPanel({ hcpCustomerId, pinnedEmailIds, onChange }: { hcpCustomerId: string; pinnedEmailIds: Set<string>; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<InboxMatch[] | null>(null);
  const [pending, start] = useTransition();

  function load(query?: string) {
    start(async () => { setMatches(await listInboxMatches(hcpCustomerId, query)); });
  }

  return (
    <div className="rounded-xl border border-dashed border-brand-300 bg-brand-50/30 p-3">
      <button type="button" onClick={() => { const next = !open; setOpen(next); if (next && matches === null) load(); }} className="flex w-full items-center justify-between text-sm font-semibold text-brand-900">
        <span>📥 From your inbox {open ? "" : "(owner only)"}</span>
        <span className="text-xs text-brand-700">{open ? "hide" : "show"}</span>
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          <form onSubmit={(e) => { e.preventDefault(); load(q.trim() || undefined); }} className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search inbox (sender, subject…) — blank = match this customer" className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
            <button type="submit" disabled={pending} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{pending ? "…" : "Search"}</button>
          </form>

          {matches === null ? null : matches.length === 0 ? (
            <p className="text-xs text-neutral-500">No matching emails. Try a search above (sender or subject).</p>
          ) : (
            <ul className="space-y-2">
              {matches.map((m) => <MatchRow key={m.emailId} match={m} hcpCustomerId={hcpCustomerId} alreadyPinned={m.alreadyPinned || pinnedEmailIds.has(m.emailId)} onPinned={onChange} />)}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MatchRow({ match, hcpCustomerId, alreadyPinned, onPinned }: { match: InboxMatch; hcpCustomerId: string; alreadyPinned: boolean; onPinned: () => void }) {
  const [attaching, setAttaching] = useState(false);
  const [vis, setVis] = useState<Visibility>("tech");
  const [note, setNote] = useState("");
  const [pinned, setPinned] = useState(alreadyPinned);
  const [pending, start] = useTransition();

  return (
    <li className="rounded-md border border-neutral-200 bg-white p-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-neutral-900">{match.subject ?? "(no subject)"}</span>
        <span className="text-xs text-neutral-400">{fmtDate(match.receivedAt)}</span>
      </div>
      <div className="text-xs text-neutral-500">{match.fromName ?? match.fromAddress ?? "—"}</div>
      {match.aiSummary ? <p className="mt-1 text-xs text-neutral-600">{match.aiSummary}</p> : match.snippet ? <p className="mt-1 text-xs text-neutral-500">{match.snippet}</p> : null}

      {pinned ? (
        <div className="mt-1 text-xs font-medium text-emerald-700">✓ Pinned</div>
      ) : attaching ? (
        <div className="mt-2 space-y-2 rounded-md bg-neutral-50 p-2">
          <select value={vis} onChange={(e) => setVis(e.target.value as Visibility)} className="rounded-md border border-neutral-300 px-2 py-1 text-xs">
            <option value="tech">Share with assigned tech</option>
            <option value="leadership">Leadership only</option>
          </select>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="How should this be treated? (optional)" className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs" />
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => start(async () => { const r = await pinEmail({ emailId: match.emailId, hcpCustomerId, visibility: vis, handlingNote: note }); if (r.ok) { setPinned(true); setAttaching(false); onPinned(); } })} className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{pending ? "Pinning…" : "Pin"}</button>
            <button type="button" onClick={() => setAttaching(false)} className="px-2 py-1 text-xs text-neutral-600">Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAttaching(true)} className="mt-1 rounded-md border border-brand-300 bg-white px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">Attach</button>
      )}
    </li>
  );
}
