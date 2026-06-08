"use client";

import { useState, useTransition, useCallback, useRef } from "react";
import Link from "next/link";
import {
  searchCaptures,
  captureAudioUrl,
  generateFromCaptures,
  pushStudioDraft,
  attachCaptureToJob,
  type Capture,
  type GenerateFromCapturesResult,
  type SearchFilters,
} from "../../lib/studio-actions";
import { createBasedOnPhotoUpload, finalizeBasedOnPhoto } from "../../lib/based-on-actions";
import { browserClient } from "@/lib/supabase-browser";

type Draft = Extract<GenerateFromCapturesResult, { ok: true }>;

const TYPES: Array<{ key: string; label: string }> = [
  { key: "all", label: "Everything" },
  { key: "recording", label: "Recordings" },
  { key: "note", label: "Notes" },
  { key: "comm", label: "Calls / Texts" },
  { key: "photo", label: "Photos" },
];

const TYPE_STYLE: Record<string, { dot: string; chip: string; label: string }> = {
  recording: { dot: "bg-indigo-500", chip: "bg-indigo-50 text-indigo-700 ring-indigo-200", label: "🎤 recording" },
  note: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700 ring-amber-200", label: "📝 note" },
  comm: { dot: "bg-sky-500", chip: "bg-sky-50 text-sky-700 ring-sky-200", label: "💬 comm" },
  photo: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "📷 photo" },
};

function keyOf(c: Capture) {
  return `${c.capture_type}:${c.capture_id}`;
}

function fmtDate(s: string) {
  if (!s) return "";
  return s.slice(0, 10);
}

export function StudioStation({ initial }: { initial: Capture[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [customerFilter, setCustomerFilter] = useState<{ id: string; name: string } | null>(null);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [results, setResults] = useState<Capture[]>(initial);
  const [selected, setSelected] = useState<Record<string, Capture>>({});
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<{ ok: boolean; msg: string; url?: string | null; warning?: string } | null>(null);
  const [attachFor, setAttachFor] = useState<string | null>(null);
  const [attachInput, setAttachInput] = useState("");
  const [attachMsg, setAttachMsg] = useState<{ key: string; ok: boolean; text: string; hcpJobId?: string; matches?: Array<{ hcp_job_id: string; label: string }> } | null>(null);
  const [uploadedPhotos, setUploadedPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [searching, startSearch] = useTransition();
  const [generating, startGenerate] = useTransition();
  const [pushing, startPush] = useTransition();
  const [attaching, startAttach] = useTransition();
  const reqIdRef = useRef(0);
  const lastAudioReq = useRef<string | null>(null);

  const runSearch = useCallback((q: string, t: string, f: SearchFilters) => {
    const myId = ++reqIdRef.current;
    startSearch(async () => {
      const rows = await searchCaptures(q, t, f);
      // Drop a stale response if a newer search was dispatched meanwhile.
      if (reqIdRef.current === myId) setResults(rows);
    });
  }, []);

  // Build the active filter set, with optional overrides (state writes are async,
  // so a changed control passes its new value explicitly).
  const filtersWith = (over: Partial<{ customerId: string | null; since: string; until: string }> = {}): SearchFilters => ({
    customerId: (over.customerId !== undefined ? over.customerId : customerFilter?.id) || undefined,
    since: (over.since !== undefined ? over.since : since) || undefined,
    until: (over.until !== undefined ? over.until : until) || undefined,
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query, type, filtersWith());
  };

  const pickType = (t: string) => {
    setType(t);
    runSearch(query, t, filtersWith());
  };

  const pickCustomer = (cap: Capture) => {
    if (!cap.hcp_customer_id) return;
    const c = { id: cap.hcp_customer_id, name: cap.customer_name ?? "customer" };
    setCustomerFilter(c);
    runSearch(query, type, filtersWith({ customerId: c.id }));
  };
  const clearCustomer = () => {
    setCustomerFilter(null);
    runSearch(query, type, filtersWith({ customerId: null }));
  };

  const toggle = (c: Capture) => {
    const k = keyOf(c);
    setSelected((prev) => {
      const next = { ...prev };
      if (next[k]) delete next[k];
      else next[k] = c;
      return next;
    });
  };

  const play = async (c: Capture) => {
    const k = keyOf(c);
    if (playing?.id === k) {
      setPlaying(null);
      return;
    }
    lastAudioReq.current = k;
    setLoadingId(k);
    const url = await captureAudioUrl(c.capture_id); // raw recording id for the signer
    if (lastAudioReq.current !== k) return; // a newer Play superseded this one
    setLoadingId(null);
    if (url) setPlaying({ id: k, url });
  };

  const build = () => {
    const sel = Object.values(selected);
    if (!sel.length) return;
    setGenError(null);
    setDraft(null);
    // Pre-flight: don't let a selection span customers (the server rejects it too).
    const custs = [...new Set(sel.map((c) => c.hcp_customer_id).filter(Boolean))];
    if (custs.length > 1) {
      setGenError("Selected captures span multiple customers — pick from a single customer or job.");
      return;
    }
    const keys = sel.map((c) => ({ t: c.capture_type, id: c.capture_id }));
    startGenerate(async () => {
      setPushResult(null);
      const res = await generateFromCaptures(keys, uploadedPhotos);
      if (res.ok) setDraft(res);
      else setGenError(res.error);
    });
  };

  const handleUploadPhotos = async (files: File[]) => {
    if (!files.length) return;
    setUploadingPhoto(true);
    const urls: string[] = [];
    const supa = browserClient();
    for (const f of files) {
      const slot = await createBasedOnPhotoUpload({ mime: f.type });
      if (!slot.ok) continue;
      const { error: upErr } = await supa.storage
        .from("job-photos")
        .uploadToSignedUrl(slot.path, slot.token, f, { contentType: f.type || "image/jpeg" });
      if (upErr) continue;
      const fin = await finalizeBasedOnPhoto({ path: slot.path });
      if (fin.ok) urls.push(fin.url);
    }
    setUploadedPhotos((p) => [...p, ...urls].slice(0, 8));
    setUploadingPhoto(false);
  };

  const pushToHcp = () => {
    if (!draft) return;
    setPushResult(null);
    startPush(async () => {
      const res = await pushStudioDraft(draft.options, draft.hcpCustomerId, draft.hcpJobId);
      if (res.ok) setPushResult({ ok: true, msg: `✓ Estimate ${res.estimate_number} created in HCP`, url: res.hcp_url, warning: res.warning });
      else setPushResult({ ok: false, msg: res.error });
    });
  };

  const applyAttach = (k: string, res: Awaited<ReturnType<typeof attachCaptureToJob>>) => {
    if (res.ok) {
      setAttachMsg({ key: k, ok: true, text: `✓ ${res.label}`, hcpJobId: res.hcp_job_id });
      const custName = res.label.split(" · ")[0];
      setResults((rows) => rows.map((r) => (keyOf(r) === k ? { ...r, hcp_job_id: res.hcp_job_id, customer_name: custName } : r)));
      setAttachFor(null);
      setAttachInput("");
    } else {
      setAttachMsg({ key: k, ok: false, text: res.error, matches: res.matches });
    }
  };

  const doAttach = (c: Capture) => {
    const k = keyOf(c);
    startAttach(async () => applyAttach(k, await attachCaptureToJob(c.capture_id, attachInput)));
  };

  // Attach by a resolved canonical job id (resolveJobRef short-circuits on the
  // job_ prefix, so picking a candidate never re-triggers the ambiguity).
  const attachToJobId = (c: Capture, jobId: string) => {
    const k = keyOf(c);
    startAttach(async () => applyAttach(k, await attachCaptureToJob(c.capture_id, jobId)));
  };

  const selCount = Object.keys(selected).length;
  const selList = Object.values(selected);
  const draftCustomerId = draft?.hcpCustomerId;

  return (
    <div className="pb-28">
      {/* Search + type chips */}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcripts, notes, calls, texts, photos…"
            className="flex-1 rounded-lg border border-neutral-300 px-3.5 py-2.5 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-100"
          />
          <button
            type="submit"
            className="rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-navy-800 disabled:opacity-50"
            disabled={searching}
          >
            {searching ? "…" : "Search"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => pickType(t.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                type === t.key
                  ? "bg-navy-900 text-white ring-navy-900"
                  : "bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <label className="flex items-center gap-1">
            <span>From</span>
            <input
              type="date"
              value={since}
              onChange={(e) => { setSince(e.target.value); runSearch(query, type, filtersWith({ since: e.target.value })); }}
              className="rounded border border-neutral-300 px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-1">
            <span>to</span>
            <input
              type="date"
              value={until}
              onChange={(e) => { setUntil(e.target.value); runSearch(query, type, filtersWith({ until: e.target.value })); }}
              className="rounded border border-neutral-300 px-2 py-1"
            />
          </label>
          {customerFilter ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-navy-100 px-2.5 py-1 text-navy-800">
              👤 {customerFilter.name}
              <button type="button" onClick={clearCustomer} className="ml-0.5 font-bold leading-none hover:text-navy-950" aria-label="Clear customer filter">×</button>
            </span>
          ) : null}
        </div>
      </form>

      {/* Results */}
      <div className={`mt-4 space-y-2 transition-opacity ${searching ? "pointer-events-none opacity-40" : ""}`} aria-busy={searching}>
        {results.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
            {searching ? "Searching…" : "No captures match. Try a broader term or a different type."}
          </p>
        ) : (
          results.map((c) => {
            const k = keyOf(c);
            const isSel = !!selected[k];
            const st = TYPE_STYLE[c.capture_type] ?? { dot: "bg-neutral-400", chip: "bg-neutral-100 text-neutral-600 ring-neutral-200", label: c.capture_type };
            return (
              <div
                key={k}
                onClick={() => toggle(c)}
                className={`cursor-pointer rounded-xl border px-4 py-3 transition ${
                  isSel ? "border-navy-500 bg-navy-50/40 ring-1 ring-navy-200" : "border-neutral-200 bg-white hover:border-neutral-300"
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggle(c)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 h-4 w-4 shrink-0 accent-navy-700"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${st.chip}`}>
                        {st.label}
                        {c.subtype && c.capture_type !== "note" ? ` · ${c.subtype}` : ""}
                      </span>
                      <span className="text-sm font-medium text-neutral-900">{c.title || "(untitled)"}</span>
                      {c.status === "needs_review" ? (
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 ring-1 ring-rose-200">
                          ⚠ transcript suspect
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-neutral-500">
                      {c.customer_name ? (
                        c.hcp_customer_id ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); pickCustomer(c); }}
                            className="font-medium text-neutral-700 hover:text-navy-700 hover:underline"
                            title="Filter to this customer"
                          >
                            {c.customer_name}
                          </button>
                        ) : (
                          <span className="font-medium text-neutral-700">{c.customer_name}</span>
                        )
                      ) : null}
                      {c.tech ? <span>· {c.tech}</span> : null}
                      <span>· {fmtDate(c.occurred_at)}</span>
                      {c.body_len > 0 ? <span>· {c.body_len.toLocaleString()} chars</span> : null}
                      {c.hcp_job_id ? (
                        <Link
                          href={`/job/${c.hcp_job_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-navy-600 hover:underline"
                        >
                          · open job ↗
                        </Link>
                      ) : null}
                    </div>
                    {c.snippet ? <p className="mt-1 line-clamp-2 text-[13px] text-neutral-600">{c.snippet}</p> : null}

                    {/* media affordances */}
                    {c.media_kind === "audio" ? (
                      <button
                        type="button"
                        disabled={loadingId === k}
                        onClick={(e) => {
                          e.stopPropagation();
                          void play(c);
                        }}
                        className="mt-2 inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                      >
                        {loadingId === k ? "⏳ Loading…" : playing?.id === k ? "⏹ Stop" : "▶ Play"}
                      </button>
                    ) : null}
                    {c.media_kind === "audio" && playing?.id === k ? (
                      <audio src={playing.url} controls autoPlay className="mt-2 h-9 w-full" onClick={(e) => e.stopPropagation()} />
                    ) : null}
                    {c.media_kind === "image" && c.media_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.media_url}
                        alt={c.title}
                        className="mt-2 h-20 w-20 rounded-md object-cover ring-1 ring-neutral-200"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : null}

                    {/* Re-point an orphaned/mis-targeted recording at a job (the lost-recording fix) */}
                    {c.capture_type === "recording" ? (
                      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                        {attachFor === k ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <input
                              value={attachInput}
                              onChange={(e) => setAttachInput(e.target.value)}
                              placeholder="Job # or invoice"
                              className="w-40 rounded border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-navy-500"
                            />
                            <button
                              type="button"
                              disabled={attaching || !attachInput.trim()}
                              onClick={() => doAttach(c)}
                              className="rounded bg-navy-900 px-2 py-1 text-xs text-white hover:bg-navy-800 disabled:opacity-50"
                            >
                              {attaching ? "…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setAttachFor(null); setAttachMsg(null); }}
                              className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setAttachFor(k); setAttachInput(""); setAttachMsg(null); }}
                            className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                          >
                            📎 {c.hcp_job_id ? "Re-attach to job" : "Attach to job"}
                          </button>
                        )}
                        {attachMsg && attachMsg.key === k ? (
                          <p className={`mt-1 text-[11px] ${attachMsg.ok ? "text-emerald-700" : "text-rose-600"}`}>
                            {attachMsg.text}
                            {attachMsg.ok && attachMsg.hcpJobId ? (
                              <Link href={`/job/${attachMsg.hcpJobId}`} className="ml-1 font-medium underline">Open job →</Link>
                            ) : null}
                          </p>
                        ) : null}
                        {attachMsg && attachMsg.key === k && attachMsg.matches?.length ? (
                          <div className="mt-1 flex flex-col gap-1">
                            {attachMsg.matches.map((m) => (
                              <button
                                key={m.hcp_job_id}
                                type="button"
                                disabled={attaching}
                                onClick={() => attachToJobId(c, m.hcp_job_id)}
                                className="rounded border border-neutral-300 px-2 py-1 text-left text-[11px] text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Draft result */}
      {genError ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{genError}</div>
      ) : null}
      {draft ? (
        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-emerald-900">Draft from {selCount} capture{selCount === 1 ? "" : "s"}</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={pushToHcp}
                disabled={pushing}
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {pushing ? "Pushing…" : "🚀 Push to HCP"}
              </button>
              {draftCustomerId ? (
                <Link
                  href={`/estimate/new?customer=${draftCustomerId}`}
                  className="rounded-md border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                >
                  Refine in builder →
                </Link>
              ) : null}
            </div>
          </div>
          {pushResult ? (
            <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${pushResult.ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
              {pushResult.msg}
              {pushResult.ok && pushResult.url ? (
                <a href={pushResult.url} target="_blank" rel="noreferrer" className="ml-2 font-medium underline">Open in HCP ↗</a>
              ) : null}
              {pushResult.ok && pushResult.warning ? (
                <div className="mt-1 text-amber-700">⚠ {pushResult.warning}</div>
              ) : null}
            </div>
          ) : null}
          {draft.sourceSummary ? (
            <p className="mt-1 text-[12px] text-emerald-800/80">{draft.sourceSummary}</p>
          ) : null}
          {draft.note ? (
            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/70 px-3 py-2 text-[13px] text-neutral-700">{draft.note}</p>
          ) : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {draft.options.map((opt, i) => (
              <div key={i} className="rounded-xl border border-neutral-200 bg-white p-3">
                <p className="text-sm font-semibold text-neutral-900">{opt.name}</p>
                <ul className="mt-1.5 space-y-1">
                  {opt.lines.map((ln, j) => (
                    <li key={j} className="text-[12px] text-neutral-600">
                      <span className="font-medium text-neutral-800">{ln.name}</span>
                      {Number(ln.hours) > 0 || Number(ln.materials) > 0 ? (
                        <span className="text-neutral-400">
                          {" "}· {ln.crew || "1"}-crew {ln.hours || "0"}h
                          {Number(ln.materials) > 0 ? ` · $${ln.materials} mat` : ""}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Sticky selection bar */}
      {selCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 backdrop-blur">
          <div className="mx-auto max-w-[1600px] px-4 py-3">
            {uploadedPhotos.length ? (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-neutral-500">Photos for the draft:</span>
                {uploadedPhotos.map((url, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-12 w-12 rounded object-cover ring-1 ring-neutral-200" />
                    <button
                      type="button"
                      onClick={() => setUploadedPhotos((p) => p.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold leading-none text-white"
                      aria-label="Remove photo"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-neutral-700">{selCount} selected</span>
              <span className="hidden text-xs text-neutral-400 sm:inline">
                {selList.slice(0, 3).map((c) => c.title).join(" · ")}
                {selCount > 3 ? ` +${selCount - 3}` : ""}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <label className="cursor-pointer rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
                  {uploadingPhoto ? "Uploading…" : "📤 Add photos"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => { const fs = e.target.files ? Array.from(e.target.files) : []; e.currentTarget.value = ""; void handleUploadPhotos(fs); }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setSelected({})}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={build}
                  disabled={generating}
                  className="rounded-md bg-navy-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
                >
                  {generating ? "Building…" : "Build estimate from selected →"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
