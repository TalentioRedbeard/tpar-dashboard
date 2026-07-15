"use client";

// Obligations board client — tap an item open, complete it with an optional
// evidence note + actual amount, or give a dateless obligation its date.
// Amounts render from cents; nothing here does money math beyond display.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeEvent, setDueDate, type BoardRow } from "@/lib/office/actions";

const CATEGORY_ICON: Record<string, string> = {
  license: "📜", insurance: "🛡️", tax: "🏛️", filing: "🗂️", subscription: "🔁",
  debt: "🏦", lease: "🏢", banking: "💳", payroll: "🧾", other: "•",
};

function dollars(cents: number | null): string | null {
  if (cents === null || cents === undefined) return null;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function daysFromToday(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
}

type Bucket = { key: string; title: string; tone: string; rows: BoardRow[] };

export function OfficeBoard({ rows }: { rows: BoardRow[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [dateDraft, setDateDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const buckets = useMemo<Bucket[]>(() => {
    const overdue: BoardRow[] = [], week: BoardRow[] = [], month: BoardRow[] = [],
      later: BoardRow[] = [], dateless: BoardRow[] = [], paused: BoardRow[] = [];
    for (const r of rows) {
      if (r.status === "paused") { paused.push(r); continue; }
      if (!r.next_due_on) { dateless.push(r); continue; }
      const d = daysFromToday(r.next_due_on);
      if (d < 0) overdue.push(r);
      else if (d <= 7) week.push(r);
      else if (d <= 31) month.push(r);
      else later.push(r);
    }
    return [
      { key: "overdue", title: "Overdue", tone: "border-red-300 bg-red-50", rows: overdue },
      { key: "week", title: "This week", tone: "border-amber-300 bg-amber-50", rows: week },
      { key: "month", title: "This month", tone: "border-neutral-200 bg-white", rows: month },
      { key: "later", title: "Scheduled", tone: "border-neutral-200 bg-white", rows: later },
      { key: "dateless", title: "Needs a date", tone: "border-violet-300 bg-violet-50", rows: dateless },
      { key: "paused", title: "Paused", tone: "border-neutral-200 bg-neutral-50", rows: paused },
    ].filter((b) => b.rows.length > 0);
  }, [rows]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setErr(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) { setErr(r.error ?? "Something went wrong."); return; }
      setOpenId(null); setNote(""); setAmount(""); setDateDraft("");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {err ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{err}</div> : null}
      {buckets.map((b) => (
        <section key={b.key} className={`rounded-2xl border p-4 ${b.tone}`}>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-navy-900">
            {b.title} <span className="font-normal text-neutral-500">({b.rows.length})</span>
          </h2>
          <ul className="space-y-2">
            {b.rows.map((r) => {
              const open = openId === r.obligation_id;
              const amt = dollars(r.amount_cents);
              return (
                <li key={r.obligation_id} className="rounded-xl border border-neutral-200 bg-white">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : r.obligation_id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden>{CATEGORY_ICON[r.category] ?? "•"}</span>
                      <span className="truncate font-medium text-navy-900">{r.name}</span>
                      {r.auto_pay ? <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">auto</span> : null}
                    </span>
                    <span className="shrink-0 text-sm text-neutral-600">
                      {r.next_due_on ?? "no date"}{amt ? ` · ${amt}` : ""}
                    </span>
                  </button>
                  {open ? (
                    <div className="space-y-3 border-t border-neutral-100 px-4 py-3 text-sm">
                      {r.counterparty ? <div className="text-neutral-700">↳ {r.counterparty} · {r.cadence}</div> : null}
                      {r.evidence_hint ? <div className="text-neutral-500">evidence: {r.evidence_hint}</div> : null}
                      {r.source_notes ? <div className="rounded-lg bg-neutral-50 p-2 text-neutral-600">{r.source_notes}</div> : null}

                      {r.open_event_id ? (
                        <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
                          <div className="font-medium text-navy-900">Mark done — due {r.open_event_due_on}</div>
                          <input
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Evidence note (what proves it — email, confirmation #…)"
                            className="w-full rounded-md border border-neutral-300 px-3 py-2"
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              value={amount}
                              onChange={(e) => setAmount(e.target.value)}
                              placeholder="Actual $ (optional)"
                              inputMode="decimal"
                              className="w-40 rounded-md border border-neutral-300 px-3 py-2"
                            />
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => act(() => completeEvent({ eventId: r.open_event_id!, note, amountDollars: amount }))}
                              className="rounded-md bg-brand-700 px-4 py-2 font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                            >
                              {pending ? "Saving…" : "✓ Done"}
                            </button>
                          </div>
                        </div>
                      ) : !r.next_due_on ? (
                        <div className="space-y-2 rounded-lg border border-violet-200 p-3">
                          <div className="font-medium text-navy-900">Set the due date</div>
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="date"
                              value={dateDraft}
                              onChange={(e) => setDateDraft(e.target.value)}
                              className="rounded-md border border-neutral-300 px-3 py-2"
                            />
                            <button
                              type="button"
                              disabled={pending || !dateDraft}
                              onClick={() => act(() => setDueDate({ obligationId: r.obligation_id, dueOn: dateDraft }))}
                              className="rounded-md bg-violet-700 px-4 py-2 font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                            >
                              {pending ? "Saving…" : "Set date"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-neutral-500">Scheduled — the watcher opens it for completion when it comes due.</div>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
