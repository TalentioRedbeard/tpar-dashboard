"use client";

// Handoff checklist verbs — advance a contact-of-record transition with an
// optional note (dated automatically). Mirrors the TimecardVerbs pattern.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContactStatus } from "@/lib/office/actions";

type Contact = {
  id: string; system: string; purpose: string | null; named_contact: string | null;
  login_holder: string | null; transition_status: string; notes: string | null;
};

const STATUS_TONE: Record<string, string> = {
  done: "bg-emerald-100 text-emerald-800",
  in_progress: "bg-amber-100 text-amber-800",
  not_started: "bg-red-100 text-red-800",
  n_a: "bg-neutral-100 text-neutral-600",
};
const STATUS_LABEL: Record<string, string> = {
  done: "done", in_progress: "in progress", not_started: "not started", n_a: "n/a",
};

export function ContactVerbs({ contacts }: { contacts: Contact[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const move = (id: string, status: "not_started" | "in_progress" | "done" | "n_a") => {
    setErr(null);
    startTransition(async () => {
      const r = await updateContactStatus({ contactId: id, status, note });
      if (!r.ok) { setErr(r.error ?? "Update failed."); return; }
      setOpenId(null); setNote("");
      router.refresh();
    });
  };

  return (
    <div>
      {err ? <div className="mb-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-900">{err}</div> : null}
      <ul className="divide-y divide-neutral-100 text-sm">
        {contacts.map((c) => {
          const open = openId === c.id;
          return (
            <li key={c.id} className="py-2.5">
              <button type="button" onClick={() => setOpenId(open ? null : c.id)}
                className="flex w-full items-start justify-between gap-3 text-left">
                <div className="min-w-0">
                  <div className="font-medium text-navy-900">{c.system}</div>
                  <div className="text-xs text-neutral-500">
                    {c.purpose ?? ""}
                    {c.named_contact ? ` · named contact: ${c.named_contact}` : ""}
                    {c.login_holder ? ` · login: ${c.login_holder}` : ""}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[c.transition_status] ?? ""}`}>
                  {STATUS_LABEL[c.transition_status] ?? c.transition_status}
                </span>
              </button>
              {open ? (
                <div className="mt-2 space-y-2 rounded-lg border border-neutral-200 p-3">
                  {c.notes ? <div className="whitespace-pre-line text-xs text-neutral-500">{c.notes}</div> : null}
                  <input value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Note (optional — what changed)"
                    className="w-full rounded-md border border-neutral-300 px-3 py-2" />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={pending} onClick={() => move(c.id, "in_progress")}
                      className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">Started</button>
                    <button type="button" disabled={pending} onClick={() => move(c.id, "done")}
                      className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">✓ Done</button>
                    <button type="button" disabled={pending} onClick={() => move(c.id, "n_a")}
                      className="rounded-md bg-neutral-200 px-3 py-1.5 text-sm font-semibold text-navy-900 hover:bg-neutral-300 disabled:opacity-50">N/A</button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
