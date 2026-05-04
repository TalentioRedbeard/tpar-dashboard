// /admin/salesask — manual review for SalesAsk recording bindings.
// Per Danny 2026-05-04 (#126). Lists every recording with its current
// binding + confidence + actions to confirm / re-link / unbind.

import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { getRecordings } from "./actions";
import { RecordingRow } from "./RecordingRow";

export const dynamic = "force-dynamic";

export default async function SalesAskAdminPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/admin/salesask");
  if (!me.isAdmin && !me.isManager) {
    return (
      <PageShell title="Admin only" description="SalesAsk binding review is for leadership.">
        <EmptyState title="Not authorized." />
      </PageShell>
    );
  }

  const recordings = await getRecordings();

  const lowConf = recordings.filter((r) => Number(r.match_confidence ?? 0) < 1 && r.hcp_job_id);
  const unbound = recordings.filter((r) => !r.hcp_job_id);
  const confirmed = recordings.filter((r) => Number(r.match_confidence ?? 0) >= 1 && r.hcp_job_id);

  return (
    <PageShell
      kicker="Admin · SalesAsk"
      title="Recording bindings"
      description={
        <span>
          Review which job each SalesAsk recording is attached to.
          Auto-bindings at &lt;1.0 confidence are flagged for confirmation.
        </span>
      }
    >
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Need review" value={lowConf.length} tone="amber" />
        <Stat label="Unbound" value={unbound.length} tone={unbound.length > 0 ? "red" : "neutral"} />
        <Stat label="Confirmed" value={confirmed.length} tone="emerald" />
      </div>

      {lowConf.length > 0 && (
        <Section
          title="Need review"
          description="Auto-matched but confidence < 1.0. Tap Confirm if the binding looks right, Re-link to pick a different job."
        >
          <ul className="space-y-3">
            {lowConf.map((r) => (
              <RecordingRow key={r.id} rec={r} />
            ))}
          </ul>
        </Section>
      )}

      {unbound.length > 0 && (
        <>
          <div className="my-6" />
          <Section title="Unbound" description="No binding — pick a job to attach.">
            <ul className="space-y-3">
              {unbound.map((r) => (
                <RecordingRow key={r.id} rec={r} />
              ))}
            </ul>
          </Section>
        </>
      )}

      {confirmed.length > 0 && (
        <>
          <div className="my-6" />
          <Section title="Confirmed" description="Bound to a job at confidence 1.0 (manual or invoice-exact).">
            <ul className="space-y-3 opacity-75">
              {confirmed.map((r) => (
                <RecordingRow key={r.id} rec={r} />
              ))}
            </ul>
          </Section>
        </>
      )}
    </PageShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "amber" | "red" | "emerald" | "neutral" }) {
  const colorClass =
    tone === "amber" ? "border-amber-300 bg-amber-50 text-amber-900" :
    tone === "red" ? "border-red-300 bg-red-50 text-red-900" :
    tone === "emerald" ? "border-emerald-300 bg-emerald-50 text-emerald-900" :
    "border-neutral-200 bg-white text-neutral-900";
  return (
    <div className={`rounded-2xl border p-4 ${colorClass}`}>
      <div className="text-xs font-medium uppercase tracking-wide opacity-75">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
