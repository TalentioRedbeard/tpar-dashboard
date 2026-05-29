"use client";

// Client UI for the forward-to-attach queue. Each forwarded email gets a small
// form: search a customer, optionally pick a job, set visibility, add a handling
// note, then Attach (or Dismiss). Server actions live in app/attach/actions.ts.

import { useState, useTransition } from "react";
import {
  searchCustomers,
  listJobsForCustomer,
  attachFromQueue,
  dismissQueued,
  type QueueEmail,
  type CustomerOption,
  type JobOption,
  type Visibility,
} from "@/app/attach/actions";

export function AttachQueue({ initial }: { initial: QueueEmail[] }) {
  const [items, setItems] = useState<QueueEmail[]>(initial);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">
        Nothing waiting. Forward a client email to{" "}
        <code className="font-mono text-neutral-700">ddunlop+attach@tulsapar.com</code>{" "}
        and it&apos;ll appear here within a few minutes.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((it) => (
        <AttachCard
          key={it.emailId}
          email={it}
          onDone={() => setItems((xs) => xs.filter((x) => x.emailId !== it.emailId))}
        />
      ))}
    </div>
  );
}

function AttachCard({ email, onDone }: { email: QueueEmail; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<CustomerOption | null>(null);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [jobId, setJobId] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("tech");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function onSearch(value: string) {
    setQuery(value);
    setPicked(null);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      setResults(await searchCustomers(value));
    } finally {
      setSearching(false);
    }
  }

  async function choose(c: CustomerOption) {
    setPicked(c);
    setResults([]);
    setQuery(c.name ?? c.email ?? "");
    setJobId("");
    setJobs(await listJobsForCustomer(c.id));
  }

  function onAttach() {
    if (!picked) {
      setErr("Pick a customer first.");
      return;
    }
    setErr(null);
    start(async () => {
      const res = await attachFromQueue({
        emailId: email.emailId,
        hcpCustomerId: picked.id,
        hcpJobId: jobId || null,
        visibility,
        handlingNote: note,
      });
      if (res.ok) onDone();
      else setErr(res.error ?? "Couldn't attach.");
    });
  }

  function onDismiss() {
    setErr(null);
    start(async () => {
      const res = await dismissQueued(email.emailId);
      if (res.ok) onDone();
      else setErr(res.error ?? "Couldn't dismiss.");
    });
  }

  const received = email.receivedAt ? new Date(email.receivedAt).toLocaleString() : "";

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <div className="font-medium text-neutral-900">{email.subject || "(no subject)"}</div>
        {received ? <div className="shrink-0 text-xs text-neutral-400">{received}</div> : null}
      </div>
      <div className="mb-2 text-xs text-neutral-500">
        from {email.fromName || email.fromAddress || "unknown sender"}
      </div>
      {email.aiSummary || email.snippet ? (
        <p className="mb-3 line-clamp-3 text-sm text-neutral-600">{email.aiSummary || email.snippet}</p>
      ) : null}

      <div className="space-y-2 border-t border-neutral-100 pt-3">
        <div className="relative">
          <input
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search customer by name or email…"
            className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-neutral-400 focus:outline-none"
          />
          {searching ? <div className="absolute right-3 top-2 text-xs text-neutral-400">…</div> : null}
          {results.length > 0 ? (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-neutral-200 bg-white shadow-lg">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => choose(c)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                  >
                    <span className="font-medium text-neutral-800">{c.name || "(no name)"}</span>
                    {c.email ? <span className="ml-2 text-neutral-400">{c.email}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {picked ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 ring-1 ring-inset ring-emerald-200">
              {picked.name || picked.email}
            </span>
            {jobs.length > 0 ? (
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
              >
                <option value="">Whole customer (no specific job)</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.label}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-1.5 text-sm text-neutral-600">
            <input
              type="radio"
              name={`vis-${email.emailId}`}
              checked={visibility === "tech"}
              onChange={() => setVisibility("tech")}
            />
            Share with assigned tech
          </label>
          <label className="flex items-center gap-1.5 text-sm text-neutral-600">
            <input
              type="radio"
              name={`vis-${email.emailId}`}
              checked={visibility === "leadership"}
              onChange={() => setVisibility("leadership")}
            />
            Leadership only
          </label>
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Handling note — how should this be treated? (optional)"
          rows={2}
          className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-neutral-400 focus:outline-none"
        />

        {err ? <div className="text-xs text-red-600">{err}</div> : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAttach}
            disabled={pending || !picked}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? "Working…" : "Attach"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={pending}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
