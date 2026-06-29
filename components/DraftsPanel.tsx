"use client";

import { useCallback, useState } from "react";
import { requestDraft, markDraftSent, discardDraft, listDrafts, type DraftRow } from "@/lib/draft-actions";
import { searchEstimateCustomers, type EstimateCustomerHit } from "@/lib/multi-option-estimate-actions";

const TASKS = ["greeting", "estimate", "report"];

export function DraftsPanel({ initial }: { initial: DraftRow[] }) {
  const [drafts, setDrafts] = useState(initial);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<EstimateCustomerHit[]>([]);
  const [sel, setSel] = useState<EstimateCustomerHit | null>(null);
  const [task, setTask] = useState("greeting");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => { setDrafts(await listDrafts()); }, []);

  const search = useCallback(async (term: string) => {
    setQ(term); setSel(null);
    setHits(term.trim().length >= 2 ? await searchEstimateCustomers(term) : []);
  }, []);

  async function generate() {
    if (!sel) { setMsg("Pick a customer first."); return; }
    setBusy(true); setMsg("");
    const r = await requestDraft({ hcpCustomerId: sel.hcp_customer_id, task });
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? "failed"); return; }
    setMsg("Requested — the on-prem 70B is drafting (~1-2 min). Hit Refresh.");
    setHits([]); setQ(""); setSel(null);
    await refresh();
  }

  async function copy(t: string) { try { await navigator.clipboard.writeText(t); setMsg("Copied."); } catch { setMsg("copy failed"); } }
  async function sent(id: string) { await markDraftSent(id); await refresh(); }
  async function discard(id: string) { await discardDraft(id); await refresh(); }

  return (
    <div className="space-y-5">
      {/* request form */}
      <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
        <div className="text-xs font-semibold text-neutral-600">Request a draft</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="relative">
            <input
              value={sel ? sel.display_name : q}
              onChange={(e) => search(e.target.value)}
              placeholder="Search customer…"
              className="w-56 rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
            {hits.length > 0 && !sel ? (
              <ul className="absolute z-10 mt-1 max-h-48 w-56 overflow-auto rounded-md border border-neutral-200 bg-white shadow-lg">
                {hits.map((h) => (
                  <li key={h.hcp_customer_id}>
                    <button type="button" onClick={() => { setSel(h); setHits([]); }} className="block w-full px-2 py-1 text-left text-sm hover:bg-neutral-50">
                      {h.display_name}{h.phone10 ? <span className="text-neutral-400"> · {h.phone10}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <select value={task} onChange={(e) => setTask(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1 text-sm">
            {TASKS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button type="button" disabled={busy || !sel} onClick={generate} className="rounded-md bg-blue-600 px-3 py-1 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
            Generate draft
          </button>
          <button type="button" onClick={refresh} className="rounded-md border border-neutral-300 px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-50">Refresh</button>
        </div>
        {msg ? <div className="mt-2 text-xs text-neutral-500">{msg}</div> : null}
      </div>

      {/* drafts list */}
      {drafts.length === 0 ? (
        <div className="text-sm text-neutral-500">No drafts yet.</div>
      ) : (
        <ul className="space-y-3">
          {drafts.map((d) => (
            <li key={d.id} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-neutral-500">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5">{d.task}</span>
                <span className={d.status === "draft" ? "text-emerald-600" : d.status === "failed" ? "text-red-600" : "text-amber-600"}>{d.status}</span>
                {d.hcp_customer_id ? <span>· {d.hcp_customer_id}</span> : null}
                {d.context_used ? <span>· {d.context_used.length} ctx</span> : null}
                {d.private_context_count ? <span>· {d.private_context_count} private (on-prem)</span> : null}
              </div>
              {d.draft_text ? <p className="mt-1.5 whitespace-pre-wrap text-sm text-neutral-800">{d.draft_text}</p>
                : d.error ? <p className="mt-1.5 text-sm text-red-600">{d.error}</p>
                : <p className="mt-1.5 text-sm text-neutral-400">{d.status === "draft" ? "(empty)" : "generating on-prem…"}</p>}
              {d.status === "draft" && d.draft_text ? (
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => copy(d.draft_text!)} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50">Copy</button>
                  <button type="button" onClick={() => sent(d.id)} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Mark sent</button>
                  <button type="button" onClick={() => discard(d.id)} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50">Discard</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
