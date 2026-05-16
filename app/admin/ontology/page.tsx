// /admin/ontology — renders the most recent SYSTEM_ONTOLOGY.md snapshot
// produced by the regen-system-ontology edge function (nightly cron).
//
// The .md isn't a static file anymore — it's a row in
// public.system_ontology_snapshots. This page reads + renders.

import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";
import { getCurrentTech } from "../../../lib/current-tech";

export const metadata = { title: "System Ontology · Admin · TPAR-DB" };
export const dynamic = "force-dynamic";

export default async function OntologyPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/admin/ontology");
  if (!me.isAdmin && !me.isManager) redirect("/me");

  const supa = db();
  const [latestRes, historyRes] = await Promise.all([
    supa.from("system_ontology_snapshots").select("id, generated_at, content_md, byte_size").order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    supa.from("system_ontology_snapshots").select("id, generated_at, byte_size").order("generated_at", { ascending: false }).limit(30),
  ]);

  const snap = latestRes.data as { id: number; generated_at: string; content_md: string; byte_size: number } | null;
  const history = (historyRes.data ?? []) as Array<{ id: number; generated_at: string; byte_size: number }>;

  return (
    <PageShell kicker="Admin" title="System Ontology" backHref="/admin/system" backLabel="System map">
      {!snap ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No snapshot yet. Fire <code className="font-mono">regen-system-ontology</code> manually or wait for the 01:17 Chicago nightly cron.
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-baseline gap-3 text-xs text-neutral-500">
            <span>
              Latest snapshot:{" "}
              <strong className="text-neutral-800">
                {new Date(snap.generated_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })}
              </strong>
            </span>
            <span>·</span>
            <span>{(snap.byte_size / 1024).toFixed(1)} KB</span>
            <span>·</span>
            <span>id {snap.id}</span>
            <a
              href={`data:text/markdown;charset=utf-8,${encodeURIComponent(snap.content_md)}`}
              download={`SYSTEM_ONTOLOGY_${snap.generated_at.slice(0, 10)}.md`}
              className="ml-auto rounded-md bg-neutral-100 px-2 py-1 text-neutral-700 hover:bg-neutral-200"
            >
              ↓ Download .md
            </a>
          </div>

          <div className="overflow-auto rounded-2xl border border-neutral-200 bg-white p-4">
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-neutral-800">{snap.content_md}</pre>
          </div>

          {history.length > 1 ? (
            <details className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
              <summary className="cursor-pointer text-xs font-medium text-neutral-600 hover:text-neutral-900">
                History ({history.length} snapshots)
              </summary>
              <ul className="mt-3 space-y-1 text-xs text-neutral-600">
                {history.map((h) => (
                  <li key={h.id} className="flex items-baseline gap-3">
                    <span className="font-mono text-neutral-500">#{h.id}</span>
                    <span className="text-neutral-700">
                      {new Date(h.generated_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                    </span>
                    <span className="text-neutral-400">{(h.byte_size / 1024).toFixed(1)} KB</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
