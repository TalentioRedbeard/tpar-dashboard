// /admin/tags — #29 v1 read-only tag cockpit.
//
// Surfaces the unified entity_tags layer: TPAR's auto tags (GPT for calls;
// Madisson's HCP tags structured for jobs) next to the humans' tags, per
// dimension. Lets Danny see + trust the auto-tagger before the VAs stop
// hand-tagging. Read-only; tag editing (tpar_human) is a later phase.

import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { getSessionUser } from "../../../lib/supabase-server";
import { isAdmin } from "../../../lib/admin";
import { PageShell } from "../../../components/PageShell";
import { Section } from "../../../components/ui/Section";
import { ScrollPanel } from "../../../components/ui/ScrollPanel";
import { StatCard } from "../../../components/ui/StatCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Call + Job Tags · Admin · TPAR-DB" };

function chips(s: string | null, tone: "auto" | "human" | "job") {
  if (!s) return <span className="text-neutral-300">—</span>;
  const cls =
    tone === "auto" ? "bg-brand-50 text-brand-700 ring-brand-200"
    : tone === "human" ? "bg-amber-50 text-amber-800 ring-amber-200"
    : "bg-neutral-100 text-neutral-700 ring-neutral-200";
  return (
    <span className="flex flex-wrap gap-1">
      {s.split(", ").map((t, i) => (
        <span key={i} className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${cls}`}>{t}</span>
      ))}
    </span>
  );
}

type CallRow = {
  call_id: string; call_time: string | null; caller_phone: string | null; summary: string | null;
  gpt_call_type: string | null; gpt_call_outcome: string | null; gpt_customer_type: string | null;
  gpt_job_category: string | null; gpt_source: string | null; gpt_internal: string | null;
  va_call_type: string | null; va_call_outcome: string | null; va_internal: string | null;
};
type JobRow = {
  hcp_job_id: string; day_structure: string | null; lead_tech: string | null; derived_lead_tech: string | null;
  customer_type: string | null; derived_customer_type: string | null;
  job_category: string | null; estimate_type: string | null; source: string | null;
  quality_recall: string | null; process_marker: string | null;
};

export default async function TagsPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");
  const supa = db();

  const [covRes, callsRes, jobsRes, jobMetaRes] = await Promise.all([
    supa.from("entity_tags").select("entity_kind, source, entity_id"),
    supa.from("call_tag_compare_v").select("call_id, call_time, caller_phone, summary, gpt_call_type, gpt_call_outcome, gpt_customer_type, gpt_job_category, gpt_source, gpt_internal, va_call_type, va_call_outcome, va_internal").order("call_time", { ascending: false }).limit(60),
    supa.from("job_tag_v").select("hcp_job_id, day_structure, lead_tech, derived_lead_tech, customer_type, derived_customer_type, job_category, estimate_type, source, quality_recall, process_marker").limit(60),
    supa.from("job_360").select("hcp_job_id, customer_name, job_date").order("job_date", { ascending: false }).limit(400),
  ]);

  // Coverage counts
  const cov = (covRes.data ?? []) as Array<{ entity_kind: string; source: string; entity_id: string }>;
  const uniq = (kind: string, src: string) => new Set(cov.filter((r) => r.entity_kind === kind && r.source === src).map((r) => r.entity_id)).size;
  const callsGpt = uniq("call", "tpar_gpt");
  const callsVa = uniq("call", "callrail_va");
  const jobsMad = uniq("job", "hcp_madisson");

  const calls = (callsRes.data ?? []) as CallRow[];

  // Join jobs to metadata (name + date), order by date desc
  const jobMeta = new Map<string, { customer_name: string | null; job_date: string | null }>();
  for (const r of (jobMetaRes.data ?? []) as Array<{ hcp_job_id: string; customer_name: string | null; job_date: string | null }>) {
    if (!jobMeta.has(r.hcp_job_id)) jobMeta.set(r.hcp_job_id, { customer_name: r.customer_name, job_date: r.job_date });
  }
  const jobs = ((jobsRes.data ?? []) as JobRow[])
    .map((j) => ({ ...j, meta: jobMeta.get(j.hcp_job_id) ?? null }))
    .sort((a, b) => (b.meta?.job_date ?? "").localeCompare(a.meta?.job_date ?? ""));

  const fmtTime = (s: string | null) => s ? new Date(s).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

  return (
    <PageShell
      kicker="Admin"
      title="Call + Job Tags"
      description="TPAR auto-tags (GPT for calls, Madisson's HCP tags structured for jobs) next to the humans' tags, by dimension. Read-only — the auto-tagger runs in parallel with hand-tagging until it's trusted."
      backHref="/reports"
      backLabel="Reports"
    >
      <div className="space-y-8">
        <Section title="Coverage">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Calls auto-tagged (GPT)" value={callsGpt} tone="brand" />
            <StatCard label="Calls hand-tagged (VAs)" value={callsVa} />
            <StatCard label="Jobs tagged (Madisson)" value={jobsMad} />
            <StatCard label="Tag dimensions" value={12} />
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            VA hand-tags are mostly who-answered attribution; the GPT auto-tagger applies the full 7-dimension taxonomy. The point of v1 is to see both side-by-side.
          </p>
        </Section>

        <Section title="Calls — auto (TPAR-GPT) vs human (CallRail VA)" description="Most recent 60. Auto tags are the full taxonomy; the human row shows what the VA actually applied (often just CSR/HCPA).">
          <ScrollPanel tier="primary">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="p-2">Call</th><th className="p-2">Type</th><th className="p-2">Outcome</th>
                  <th className="p-2">Customer</th><th className="p-2">Job category</th><th className="p-2">Source</th><th className="p-2">Internal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {calls.map((c) => (
                  <tr key={c.call_id} className="align-top hover:bg-neutral-50/50">
                    <td className="p-2">
                      <div className="font-medium text-neutral-800">{fmtTime(c.call_time)}</div>
                      <div className="text-[10px] text-neutral-400">{c.caller_phone ?? "—"}</div>
                      {c.summary ? <div className="mt-0.5 max-w-[220px] truncate text-[11px] text-neutral-500" title={c.summary}>{c.summary}</div> : null}
                    </td>
                    <td className="p-2"><div className="space-y-1">{chips(c.gpt_call_type, "auto")}{c.va_call_type ? chips(c.va_call_type, "human") : null}</div></td>
                    <td className="p-2"><div className="space-y-1">{chips(c.gpt_call_outcome, "auto")}{c.va_call_outcome ? chips(c.va_call_outcome, "human") : null}</div></td>
                    <td className="p-2">{chips(c.gpt_customer_type, "auto")}</td>
                    <td className="p-2">{chips(c.gpt_job_category, "auto")}</td>
                    <td className="p-2">{chips(c.gpt_source, "auto")}</td>
                    <td className="p-2"><div className="space-y-1">{chips(c.gpt_internal, "auto")}{c.va_internal ? chips(c.va_internal, "human") : null}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollPanel>
          <p className="mt-2 text-[11px] text-neutral-400">
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-700 ring-1 ring-inset ring-brand-200">auto</span> = TPAR GPT ·{" "}
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 ring-1 ring-inset ring-amber-200">human</span> = CallRail VA
          </p>
        </Section>

        <Section title="Jobs — Madisson (HCP) vs TPAR-derived" description="Most recent 60. Madisson's HCP job tags (amber) structured by dimension. Lead Tech + Customer Type now also auto-derived (blue) from the assignment + customer history. Day-structure (multi-day) needs HCP per-visit data — #30. Job Category auto-tagging is v2.">
          <ScrollPanel tier="primary">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="p-2">Job</th><th className="p-2">Lead tech</th><th className="p-2">Day</th>
                  <th className="p-2">Customer</th><th className="p-2">Job category</th><th className="p-2">Estimate</th>
                  <th className="p-2">Source</th><th className="p-2">Quality/recall</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {jobs.map((j) => (
                  <tr key={j.hcp_job_id} className="align-top hover:bg-neutral-50/50">
                    <td className="p-2">
                      <a href={`/job/${j.hcp_job_id}`} className="font-medium text-brand-700 hover:underline">{j.meta?.customer_name ?? j.hcp_job_id.slice(0, 12)}</a>
                      <div className="text-[10px] text-neutral-400">{j.meta?.job_date ?? "—"}</div>
                    </td>
                    <td className="p-2"><div className="space-y-1">{chips(j.lead_tech, "job")}{j.derived_lead_tech ? chips(j.derived_lead_tech, "auto") : null}</div></td>
                    <td className="p-2">{chips(j.day_structure, "job")}</td>
                    <td className="p-2"><div className="space-y-1">{chips(j.customer_type, "job")}{j.derived_customer_type ? chips(j.derived_customer_type, "auto") : null}</div></td>
                    <td className="p-2">{chips(j.job_category, "job")}</td>
                    <td className="p-2">{chips(j.estimate_type, "job")}</td>
                    <td className="p-2">{chips(j.source, "job")}</td>
                    <td className="p-2">{chips(j.quality_recall, "job")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollPanel>
        </Section>
      </div>
    </PageShell>
  );
}
