// /manage/flags — the flag adjudication queue (build plan 2026-07-13 section
// 2.3). Oldest first: queues display their own rot. Gated by the /manage
// layout; the mutating verbs re-check requireManagement() in the server
// action. Decay policy (7-day escalate-vs-expire) is a pending Danny+Madisson
// call — until then, age coloring + the oldest-first sort keep rot visible;
// nothing accumulates silently.

import { PageShell } from "../../../components/PageShell";
import { getOpenFlags } from "../../../lib/flags";
import { FlagRow } from "./FlagRow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Flags · Manage · TPAR-DB" };

export default async function ManageFlagsPage() {
  const flags = await getOpenFlags();
  const stale = flags.filter((f) => Date.now() - new Date(f.created_at).getTime() > 7 * 86400_000).length;

  return (
    <PageShell
      icon="🚩"
      title="Flags"
      description="Everything the team noticed and wrote down a why for. One-tap calls: Fixed, Not a problem, Made a task, or Needs Danny. If it takes more than a minute — make it a task."
      backHref="/manage"
      backLabel="Manage"
    >
      <div className="mb-3 text-xs text-neutral-500">
        {flags.length} open{stale ? ` · ${stale} older than 7 days` : ""}
      </div>

      {flags.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          🎉 No open flags. When someone spots something off, it lands here with its what-and-why.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border-2 border-neutral-300 bg-white shadow-sm">
          <ul className="divide-y divide-neutral-100">
            {flags.map((f) => (
              <FlagRow key={f.id} flag={f} />
            ))}
          </ul>
        </div>
      )}
    </PageShell>
  );
}
