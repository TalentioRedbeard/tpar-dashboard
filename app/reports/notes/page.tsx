// Recent operator-notes audit feed. Pulls customer_notes + job_notes,
// merges by created_at desc, renders as a unified timeline so managers
// can scan what context the team has been adding without drilling into
// individual entities.
//
// Read-only. Companion to the Phase 3 write surfaces on /customer/[id]
// and /job/[id].

import Link from "next/link";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";

export const metadata = { title: "Notes feed · TPAR-DB" };

type CustomerNoteRow = {
  id: string;
  hcp_customer_id: string;
  author_email: string;
  body: string;
  created_at: string;
};

type JobNoteRow = {
  id: string;
  hcp_job_id: string;
  author_email: string;
  body: string;
  created_at: string;
};

type FeedItem = {
  kind: "customer" | "job";
  id: string;
  entityId: string;
  entityName: string | null;
  author_email: string;
  body: string;
  created_at: string;
};

export default async function NotesFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ author?: string; days?: string }>;
}) {
  const params = await searchParams;
  const author = (params.author ?? "").trim();
  const days = Math.max(1, Math.min(180, Number(params.days ?? "30")));

  const supa = db();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  let custQ = supa
    .from("customer_notes")
    .select("id, hcp_customer_id, author_email, body, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(150);
  if (author) custQ = custQ.eq("author_email", author);

  let jobQ = supa
    .from("job_notes")
    .select("id, hcp_job_id, author_email, body, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(150);
  if (author) jobQ = jobQ.eq("author_email", author);

  const [{ data: custData }, { data: jobData }] = await Promise.all([custQ, jobQ]);
  const custRows = (custData ?? []) as CustomerNoteRow[];
  const jobRows = (jobData ?? []) as JobNoteRow[];

  // Pull display names for the entities referenced
  const custIds = Array.from(new Set(custRows.map((r) => r.hcp_customer_id)));
  const jobIds = Array.from(new Set(jobRows.map((r) => r.hcp_job_id)));

  const [custNamesRes, jobNamesRes] = await Promise.all([
    custIds.length > 0
      ? supa.from("customer_360").select("hcp_customer_id, name").in("hcp_customer_id", custIds)
      : Promise.resolve({ data: [] as Array<{ hcp_customer_id: string; name: string | null }> }),
    jobIds.length > 0
      ? supa.from("job_360").select("hcp_job_id, customer_name").in("hcp_job_id", jobIds)
      : Promise.resolve({ data: [] as Array<{ hcp_job_id: string; customer_name: string | null }> }),
  ]);
  const custNameMap = new Map(((custNamesRes.data ?? []) as Array<{ hcp_customer_id: string; name: string | null }>).map((r) => [r.hcp_customer_id, r.name]));
  const jobNameMap = new Map(((jobNamesRes.data ?? []) as Array<{ hcp_job_id: string; customer_name: string | null }>).map((r) => [r.hcp_job_id, r.customer_name]));

  const items: FeedItem[] = [
    ...custRows.map((r) => ({
      kind: "customer" as const,
      id: r.id,
      entityId: r.hcp_customer_id,
      entityName: custNameMap.get(r.hcp_customer_id) ?? null,
      author_email: r.author_email,
      body: r.body,
      created_at: r.created_at,
    })),
    ...jobRows.map((r) => ({
      kind: "job" as const,
      id: r.id,
      entityId: r.hcp_job_id,
      entityName: jobNameMap.get(r.hcp_job_id) ?? null,
      author_email: r.author_email,
      body: r.body,
      created_at: r.created_at,
    })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Author counts for the dropdown
  const authorCounts = new Map<string, number>();
  for (const r of [...custRows, ...jobRows]) {
    authorCounts.set(r.author_email, (authorCounts.get(r.author_email) ?? 0) + 1);
  }
  const authors = [...authorCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <PageShell
      title="Notes feed"
      description={`${items.length} note${items.length === 1 ? "" : "s"} added in the last ${days} day${days === 1 ? "" : "s"}.`}
    >
      <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <label className="block">
          <span className="block text-xs font-medium text-neutral-600">Window</span>
          <select name="days" defaultValue={String(days)} className="mt-1 w-32 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm">
            <option value="7">7d</option>
            <option value="14">14d</option>
            <option value="30">30d</option>
            <option value="90">90d</option>
            <option value="180">180d</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-neutral-600">Author</span>
          <select name="author" defaultValue={author} className="mt-1 w-56 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm">
            <option value="">Any</option>
            {authors.map(([email, n]) => (
              <option key={email} value={email}>{email} ({n})</option>
            ))}
          </select>
        </label>
        <button type="submit" className="ml-auto rounded-md bg-brand-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-800">
          Apply
        </button>
      </form>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          No notes in this window.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => {
            const href = it.kind === "customer" ? `/customer/${it.entityId}` : `/job/${it.entityId}`;
            return (
              <li key={`${it.kind}-${it.id}`} className="rounded border border-neutral-200 bg-white p-3">
                <div className="mb-1 flex flex-wrap items-baseline gap-2 text-xs text-neutral-500">
                  <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    it.kind === "customer" ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800"
                  }`}>
                    {it.kind}
                  </span>
                  <Link href={href} className="font-medium text-neutral-900 hover:underline">
                    {it.entityName ?? it.entityId}
                  </Link>
                  <span>· {it.author_email}</span>
                  <span className="ml-auto">
                    {new Date(it.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{it.body}</p>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
