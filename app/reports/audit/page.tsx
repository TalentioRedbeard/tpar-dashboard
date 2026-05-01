// Values-gate audit page. Browser-based read of maintenance_logs rows
// where source='values-gate'. Companion to C:\hubs\scripts\values_review.py
// (the CLI version). Same data, same shape, browser surface.
//
// Per the values-gate rubric (C:\hubs\docs\VALUES_GATE.md): every auto-
// approved decision is logged with per-value pass notes + balance notes;
// every approved=false flagged for human review. This page lets Danny
// spot-check what the system has been deciding on its own.

import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { fmtDateShort } from "../../../components/Table";

export const metadata = { title: "Audit · TPAR-DB" };

type GateRow = {
  ts: string;
  level: string;
  message: string;
  context: {
    action_summary?: string;
    values?: {
      transparency?: { passed?: boolean; note?: string };
      ownership?: { passed?: boolean; note?: string };
      professionalism?: { passed?: boolean; note?: string };
    };
    balance_notes?: string;
    approved?: boolean;
    approver?: string;
    appeal_id?: string | null;
    reanalyzed_from?: string | null;
  } | null;
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ hours?: string; approver?: string; q?: string }>;
}) {
  const params = await searchParams;
  const hours = Math.max(1, Math.min(720, Number(params.hours ?? "168"))); // 7d default; 30d max
  const approver = (params.approver ?? "").trim();
  const q = (params.q ?? "").trim();

  const supa = db();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  let query = supa
    .from("maintenance_logs")
    .select("ts, level, message, context")
    .eq("source", "values-gate")
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(200);

  if (q) query = query.ilike("message", `%${q}%`);

  const { data } = await query;
  let rows = (data ?? []) as GateRow[];
  if (approver) {
    rows = rows.filter((r) => (r.context?.approver ?? "") === approver);
  }

  // Counts for the header
  const totalApproved = rows.filter((r) => r.context?.approved === true).length;
  const totalRefused = rows.filter((r) => r.context?.approved === false).length;
  const approvers = Array.from(new Set(rows.map((r) => r.context?.approver).filter((a): a is string => Boolean(a))));

  return (
    <PageShell
      title="Values-gate audit"
      description={`${rows.length} decision${rows.length === 1 ? "" : "s"} in the last ${hours}h · ${totalApproved} auto-approved · ${totalRefused} refused (apathy fired)`}
    >
      <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <label className="block">
          <span className="block text-xs font-medium text-neutral-600">Window</span>
          <select name="hours" defaultValue={String(hours)} className="mt-1 w-32 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm">
            <option value="24">24h</option>
            <option value="72">3d</option>
            <option value="168">7d</option>
            <option value="720">30d</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-neutral-600">Approver</span>
          <select name="approver" defaultValue={approver} className="mt-1 w-32 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm">
            <option value="">Any</option>
            {approvers.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-neutral-600">Search message</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="e.g. embedding"
            className="mt-1 w-64 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <button type="submit" className="ml-auto rounded-md bg-brand-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-800">
          Apply
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          No values-gate decisions in this window.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => {
            const ctx = r.context ?? {};
            const approved = ctx.approved;
            const tone = approved === false ? "border-red-200 bg-red-50" : "border-neutral-200 bg-white";
            const valNotes = (ctx.values ?? {}) as NonNullable<GateRow["context"]>["values"];
            return (
              <li key={`${r.ts}-${i}`} className={`rounded-2xl border ${tone} p-4`}>
                <header className="mb-2 flex flex-wrap items-baseline gap-3">
                  <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${approved === false ? "bg-red-200 text-red-900" : "bg-emerald-100 text-emerald-900"}`}>
                    {approved === false ? "REFUSED" : "AUTO-APPROVED"}
                  </span>
                  <span className="text-sm font-medium text-neutral-900">{r.message}</span>
                  <span className="ml-auto text-xs text-neutral-500">
                    {fmtDateShort(r.ts)} · by {ctx.approver ?? "?"}
                  </span>
                </header>

                {ctx.action_summary && (
                  <p className="mb-2 text-sm text-neutral-700">{ctx.action_summary}</p>
                )}

                <div className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                  {(["transparency", "ownership", "professionalism"] as const).map((k) => {
                    const v = valNotes?.[k];
                    if (!v) return null;
                    const ok = v.passed === true;
                    return (
                      <div key={k} className="rounded border border-neutral-200 bg-white p-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                          {ok ? "✓" : "✗"} {k}
                        </div>
                        <div className="mt-1 text-xs text-neutral-700">{v.note ?? "—"}</div>
                      </div>
                    );
                  })}
                </div>

                {ctx.balance_notes && (
                  <div className="text-xs italic text-neutral-600">balance: {ctx.balance_notes}</div>
                )}

                {(ctx.appeal_id || ctx.reanalyzed_from) && (
                  <div className="mt-1 text-xs text-amber-800">
                    {ctx.appeal_id && <>appeal: {ctx.appeal_id} </>}
                    {ctx.reanalyzed_from && <>re-analysis of: {ctx.reanalyzed_from}</>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
