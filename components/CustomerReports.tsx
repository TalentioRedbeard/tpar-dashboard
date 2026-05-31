"use client";

// Customer-360 Reports section (Phase 3). Lists AI context briefs for a customer,
// a "Request a report" button to generate a fresh one, and per-report view/edit/
// save. Leadership-only (the section is gated by the page).

import { useState, useTransition } from "react";
import { requestCustomerReport, saveCustomerReport, type CustomerReport } from "../lib/customer-reports";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function CustomerReports({ hcpCustomerId, initialReports }: { hcpCustomerId: string; initialReports: CustomerReport[] }) {
  const [reports, setReports] = useState<CustomerReport[]>(initialReports);
  const [generating, startGen] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function generate() {
    setError(null);
    startGen(async () => {
      const r = await requestCustomerReport(hcpCustomerId);
      if (r.ok) setReports((prev) => [r.report, ...prev]);
      else setError(r.error);
    });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-50"
        >
          {generating ? "Generating…" : "✨ Request a report"}
        </button>
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
        <span className="ml-auto text-[10px] text-neutral-400">AI brief from comms + jobs + notes · editable · saved here</span>
      </div>
      {reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
          No reports yet — generate one for a quick context brief on this customer.
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              onSaved={(u) => setReports((prev) => prev.map((x) => (x.id === u.id ? u : x)))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report, onSaved }: { report: CustomerReport; onSaved: (r: CustomerReport) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(report.title ?? "");
  const [body, setBody] = useState(report.body_md);
  const [saving, startSave] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    startSave(async () => {
      const r = await saveCustomerReport({ id: report.id, title, body_md: body });
      if (r.ok) { onSaved(r.report); setEditing(false); }
      else setErr(r.error);
    });
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="font-semibold text-neutral-900">{report.title ?? "Customer report"}</h4>
        <span className="text-[10px] text-neutral-400">
          {report.generated_by === "ai" ? "AI" : report.generated_by} · {fmtDate(report.created_at)}
          {report.edited_at ? ` · edited ${fmtDate(report.edited_at)}` : ""}
        </span>
        <button
          type="button"
          onClick={() => { setEditing((e) => !e); setTitle(report.title ?? ""); setBody(report.body_md); }}
          className="ml-auto rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50"
        >
          {editing ? "Cancel" : "Edit"}
        </button>
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Report title"
            className="w-full rounded-md border border-neutral-300 px-2 py-1 text-sm font-medium"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={18}
            className="w-full rounded-md border border-neutral-300 px-2 py-1 font-mono text-xs leading-relaxed"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={saving} className="rounded-md bg-brand-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
            {err ? <span className="text-xs text-red-700">{err}</span> : null}
          </div>
        </div>
      ) : (
        <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">{report.body_md}</div>
      )}
    </div>
  );
}
