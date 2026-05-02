// Time card view — read-only summary of clock entries for the signed-in
// tech. Admins see all techs; managers see all techs (read-only); regular
// techs see only their own.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { TechName } from "@/components/ui/TechName";
import { getFormerTechNames } from "@/lib/former-techs";
import { Pill } from "@/components/ui/Pill";
import Link from "next/link";

export const dynamic = "force-dynamic";

type EntryRow = {
  id: string;
  tech_id: string | null;
  tech_short_name: string | null;
  kind: string;
  ts: string;
  hcp_appointment_id: string | null;
  hcp_job_id: string | null;
  notes: string | null;
  source: string;
  hcp_mirror_status: string;
  voided_at: string | null;
  created_by: string | null;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0 && m === 0) return "—";
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

type DayBucket = {
  date: string;
  entries: EntryRow[];
  total_clocked_ms: number;
  has_open: boolean;
};

function bucketByDay(entries: EntryRow[]): DayBucket[] {
  const byDate = new Map<string, EntryRow[]>();
  for (const e of entries) {
    const d = formatDate(e.ts);
    const arr = byDate.get(d) ?? [];
    arr.push(e);
    byDate.set(d, arr);
  }
  const buckets: DayBucket[] = [];
  for (const [date, list] of byDate) {
    // entries are pre-sorted descending by ts
    let total = 0;
    let openClockIn: number | null = null;
    // Walk forwards through ascending order to compute totals
    const ascending = [...list].sort((a, b) => a.ts.localeCompare(b.ts));
    for (const e of ascending) {
      if (e.voided_at) continue;
      if (e.kind === "in") {
        openClockIn = new Date(e.ts).getTime();
      } else if (e.kind === "out" && openClockIn !== null) {
        total += new Date(e.ts).getTime() - openClockIn;
        openClockIn = null;
      }
    }
    buckets.push({
      date,
      entries: list,
      total_clocked_ms: total,
      has_open: openClockIn !== null,
    });
  }
  buckets.sort((a, b) => b.date.localeCompare(a.date));
  return buckets;
}

export default async function TimePage() {
  const me = await getCurrentTech();
  if (!me) {
    return (
      <PageShell title="Time">
        <EmptyState
          title="Sign in to view your time card"
          description="The dashboard recognizes your @tulsapar.com account."
        />
      </PageShell>
    );
  }

  const supabase = db();

  // Filter scope:
  //   admin / manager  → all techs
  //   tech             → only own rows
  let query = supabase
    .from("tech_time_entries")
    .select("id, tech_id, tech_short_name, kind, ts, hcp_appointment_id, hcp_job_id, notes, source, hcp_mirror_status, voided_at, created_by")
    .order("ts", { ascending: false })
    .limit(200);

  if (!me.isAdmin && !me.isManager) {
    if (me.tech?.tech_id) {
      query = query.eq("tech_id", me.tech.tech_id);
    } else {
      // no tech row + no admin/manager role: show nothing
      query = query.eq("tech_id", "__none__");
    }
  }

  const { data, error } = await query;
  const rows = (data ?? []) as EntryRow[];

  if (error) {
    return (
      <PageShell title="Time">
        <EmptyState title="Failed to load entries" description={error.message} />
      </PageShell>
    );
  }

  if (rows.length === 0) {
    return (
      <PageShell title="Time">
        <EmptyState
          title="No clock events yet"
          description="Use the Clock in button on the home page to start your day."
        />
      </PageShell>
    );
  }

  const buckets = bucketByDay(rows);
  const formerSet = await getFormerTechNames();
  const scopeLabel =
    me.isAdmin || me.isManager
      ? "All techs"
      : `${me.tech?.tech_short_name ?? "you"}`;

  return (
    <PageShell title="Time">
      <div className="text-sm text-brand-700 mb-3">
        Showing latest 200 events · scope: <span className="font-medium">{scopeLabel}</span>
      </div>
      <div className="space-y-6">
        {buckets.map((b) => (
          <Section key={b.date} title={b.date}>
            <div className="text-sm text-brand-700 mb-2">
              Total clocked: <span className="font-medium">{formatDuration(b.total_clocked_ms)}</span>
              {b.has_open && (
                <span className="ml-2"><Pill tone="amber">currently clocked in</Pill></span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-brand-100 text-sm">
                <thead className="bg-brand-50 text-brand-700">
                  <tr>
                    <th className="px-3 py-2 text-left">Time</th>
                    <th className="px-3 py-2 text-left">Kind</th>
                    {(me.isAdmin || me.isManager) && (
                      <th className="px-3 py-2 text-left">Tech</th>
                    )}
                    <th className="px-3 py-2 text-left">Job</th>
                    <th className="px-3 py-2 text-left">Source</th>
                    <th className="px-3 py-2 text-left">Mirror</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100">
                  {b.entries.map((e) => (
                    <tr key={e.id} className={e.voided_at ? "opacity-50 line-through" : ""}>
                      <td className="px-3 py-2 font-mono">{formatTime(e.ts)}</td>
                      <td className="px-3 py-2">
                        <Pill tone={e.kind === "in" ? "green" : "neutral"}>
                          {e.kind === "in" ? "Clock in" : "Clock out"}
                        </Pill>
                      </td>
                      {(me.isAdmin || me.isManager) && (
                        <td className="px-3 py-2">
                          <TechName name={e.tech_short_name} formerSet={formerSet} />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        {e.hcp_job_id ? (
                          <Link className="text-brand-700 hover:underline" href={`/job/${e.hcp_job_id}`}>
                            {e.hcp_job_id.slice(0, 12)}…
                          </Link>
                        ) : (
                          <span className="text-brand-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-brand-600">{e.source}</td>
                      <td className="px-3 py-2 text-brand-600">{e.hcp_mirror_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        ))}
      </div>
    </PageShell>
  );
}
