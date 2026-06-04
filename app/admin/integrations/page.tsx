// /admin/integrations — credential command center (the visual surface).
//
// Renders public.credential_health (written by the integration-probe edge fn):
// a live, authenticated liveness check per external dependency. Green = the
// credential actually authenticated just now (not "data flowed recently"). The
// nightly probe DMs Danny on any fail/warn; this page is the at-a-glance board +
// on-demand re-test. Built 2026-06-04 from the credential-resilience audit.
//
// Admin + manager gated (shows internal credential state + repair steps).

import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { Pill, type Tone } from "../../../components/ui/Pill";
import { getCurrentTech } from "../../../lib/current-tech";
import { RetestButton } from "./RetestButton";

export const metadata = { title: "Integration health · Admin · TPAR-DB" };
export const dynamic = "force-dynamic";

type Row = {
  key: string;
  integration: string;
  kind: string | null;
  status: string;
  last_checked_at: string | null;
  expires_at: string | null;
  last_error: string | null;
  repair_hint: string | null;
};

const STATUS_TONE: Record<string, Tone> = { ok: "green", warn: "amber", fail: "red", unknown: "slate" };
const STATUS_ORDER: Record<string, number> = { fail: 0, warn: 1, unknown: 2, ok: 3 };

function ageStr(iso: string | null): string {
  if (!iso) return "never";
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 48) return `${h.toFixed(1)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function expiryLabel(iso: string | null): { text: string; tone: Tone } | null {
  if (!iso) return null;
  const days = (new Date(iso).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return { text: "expired", tone: "red" };
  if (days < 1) return { text: "expires <1d", tone: "red" };
  if (days < 7) return { text: `expires in ${Math.floor(days)}d`, tone: "amber" };
  return { text: `expires in ${Math.floor(days)}d`, tone: "neutral" };
}

export default async function IntegrationsPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/admin/integrations");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  const supa = db();
  const { data } = await supa
    .from("credential_health")
    .select("key, integration, kind, status, last_checked_at, expires_at, last_error, repair_hint");
  const rows = (data ?? []) as Row[];
  rows.sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.integration.localeCompare(b.integration),
  );

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const lastChecked = rows.map((r) => r.last_checked_at).filter(Boolean).sort().pop() ?? null;

  return (
    <PageShell
      kicker="Admin"
      title="Integration health"
      description="Live credential + session status from the integration-probe. Green means the credential actually authenticated on the last check — not just 'data flowed recently'."
      help={{
        intent:
          "One board for whether every external login the system depends on is alive — HCP, Twilio, Slack, Gmail, Fly, Vercel, Supabase. Probed nightly + on demand; DMs you (and calls, if Slack is the dead channel) on any failure.",
        actions: [
          "Re-test now re-runs the live probe against every integration (~15s).",
          "Red/amber rows show the error + the exact repair step.",
          "Nightly probe runs ~8am Central and alerts you if anything breaks.",
        ],
      }}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {counts.fail ? <Pill tone="red" size="md">{counts.fail} failing</Pill> : null}
          {counts.warn ? <Pill tone="amber" size="md">{counts.warn} warning</Pill> : null}
          <Pill tone="green" size="md">{counts.ok ?? 0} healthy</Pill>
        </div>
        <RetestButton />
        <span className="text-xs text-neutral-500">Last checked {ageStr(lastChecked)} · auto nightly @ 8am CT</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          No probe results yet — click <span className="font-medium">Re-test now</span> to run the first check.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const bad = r.status === "fail" || r.status === "warn";
            const exp = expiryLabel(r.expires_at);
            return (
              <div key={r.key} className={`rounded-xl border p-3 ${bad ? "border-red-200 bg-red-50/40" : "border-neutral-200 bg-white"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={STATUS_TONE[r.status] ?? "slate"}>{r.status.toUpperCase()}</Pill>
                  <span className="font-medium text-neutral-900">{r.integration}</span>
                  <Pill tone="neutral" mono>{r.key}</Pill>
                  {r.kind ? <span className="text-[11px] text-neutral-500">{r.kind}</span> : null}
                  {exp ? <Pill tone={exp.tone}>{exp.text}</Pill> : null}
                  <span className="ml-auto text-xs text-neutral-500">checked {ageStr(r.last_checked_at)}</span>
                </div>
                {r.last_error ? <div className="mt-1 text-xs text-red-700">⚠ {r.last_error}</div> : null}
                {bad && r.repair_hint ? (
                  <div className="mt-1 text-xs text-neutral-700"><span className="font-medium">Repair:</span> {r.repair_hint}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
