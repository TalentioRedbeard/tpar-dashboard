// /snap — manual "screenshot my laptop" trigger.
// One big button. Tap it; the local PowerShell poller picks up the request
// and DMs you the screenshot URL via notify-danny.
//
// Designed for the case when /remote-control approval mirroring fails:
// you don't know what's pending on your laptop until you can see it.

import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { Pill } from "@/components/ui/Pill";
import { SnapButton } from "@/components/SnapButton";
import { getRecentRequests } from "./actions";

export const dynamic = "force-dynamic";

function fmtRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function fmtChicago(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export default async function SnapPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/snap");
  if (!me.isAdmin) {
    return (
      <PageShell title="Snap">
        <p className="text-sm text-neutral-600">Admin only.</p>
      </PageShell>
    );
  }

  const recent = await getRecentRequests();

  return (
    <PageShell
      kicker="Approval bypass"
      title="Snap my laptop"
      description="When /remote-control's approval prompt doesn't push to your phone, tap the button. The poller running on your laptop will capture the screen and DM you the URL within ≤ 5 seconds."
    >
      <section className="mb-8 mx-auto max-w-md">
        <SnapButton />
      </section>

      <Section title="Recent requests (10)">
        {recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-6 text-center text-sm text-neutral-500">
            No screenshot requests yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {recent.map((r) => {
              const tone =
                r.status === "captured" ? "green" :
                r.status === "pending"  ? "amber" :
                r.status === "failed"   ? "red"   :
                                          "neutral";
              return (
                <li key={r.id} className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <Pill tone={tone}>{r.status}</Pill>
                    <span className="text-xs text-neutral-500 font-mono">{fmtChicago(r.requested_at)}</span>
                    <span className="text-xs text-neutral-500">({fmtRel(r.requested_at)})</span>
                    {r.captured_at && (
                      <span className="text-xs text-emerald-700">captured {fmtRel(r.captured_at)}</span>
                    )}
                    {r.screenshot_url && (
                      <a href={r.screenshot_url} target="_blank" rel="noopener" className="ml-auto rounded-md bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-100">
                        Open screenshot →
                      </a>
                    )}
                    {r.failure_reason && (
                      <span className="text-xs text-red-700">{r.failure_reason}</span>
                    )}
                  </div>
                  {r.context && <div className="mt-1 text-xs text-neutral-500">context: {r.context}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="mt-10 rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4 text-xs text-neutral-600">
        <div className="font-medium text-neutral-700">How this works</div>
        <ol className="mt-1 list-decimal pl-5 leading-relaxed">
          <li>You tap the button → server action inserts a row into <code>screenshot_requests</code></li>
          <li>The PowerShell poller running on your laptop polls the table every 3 seconds</li>
          <li>When it sees a new row, it captures the screen, uploads to <code>laptop-screenshots</code> bucket, updates the row</li>
          <li>You get a Slack DM with the screenshot URL via <code>notify-danny</code></li>
        </ol>
        <p className="mt-2">
          The PowerShell poller has to be running on your laptop. See{" "}
          <Link href="/admin" className="text-brand-700 hover:underline">admin docs</Link>{" "}
          for setup; one-time install via Windows Task Scheduler at login, or run manually with{" "}
          <code>./scripts/snap-poller.ps1</code>.
        </p>
      </div>
    </PageShell>
  );
}
