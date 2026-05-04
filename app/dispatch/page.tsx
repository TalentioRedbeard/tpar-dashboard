// Dispatch — today + the next 6 days of appointments. Grouped by date,
// stamped with tech assignments. Reads appointments_master directly.

import Link from "next/link";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { fmtMoney } from "../../components/Table";
import { TechName } from "../../components/ui/TechName";
import { getFormerTechNames } from "../../lib/former-techs";

export const metadata = { title: "Dispatch · TPAR-DB" };

type Appt = {
  appointment_id: string | null;
  hcp_job_id: string | null;
  hcp_customer_id: string | null;
  scheduled_start: string;
  scheduled_end: string | null;
  status: string | null;
  appointment_type: string | null;
  tech_primary_name: string | null;
  tech_all_names: string[] | null;
  customer_name: string | null;
  street: string | null;
  city: string | null;
  total_amount: number | null;
  flags: string[] | null;
};

function chicagoDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function chicagoDateLabel(key: string): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  if (key === today) return "Today";
  if (key === tomorrow) return "Tomorrow";
  // key is YYYY-MM-DD; format weekday + Mon DD
  const d = new Date(key + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function chicagoTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusTone(status: string | null): string {
  switch ((status ?? "").toLowerCase()) {
    case "complete":
    case "complete rated":
    case "complete unrated":
      return "bg-emerald-100 text-emerald-800";
    case "in progress":
    case "en route":
      return "bg-blue-100 text-blue-800";
    case "scheduled":
      return "bg-neutral-100 text-neutral-700";
    case "canceled":
    case "cancelled":
      return "bg-red-100 text-red-800";
    case "needs scheduling":
    case "user canceled":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-neutral-100 text-neutral-600";
  }
}

export default async function DispatchPage() {
  const supa = db();

  // Use UTC bounds wide enough to cover the Chicago day window we want.
  // Starts: today 00:00 Chicago. Ends: today + 7 days 00:00 Chicago.
  const nowCtKey = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const startUtc = new Date(`${nowCtKey}T00:00:00-05:00`).toISOString();
  const endDate = new Date(new Date(`${nowCtKey}T00:00:00-05:00`).getTime() + 7 * 86_400_000).toISOString();

  // Stale window: appointments scheduled >7d ago that are still in
  // 'scheduled' / 'needs scheduling' status — likely operational debt.
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [upcomingRes, staleRes] = await Promise.all([
    supa
      .from("appointments_master")
      .select("appointment_id, hcp_job_id, hcp_customer_id, scheduled_start, scheduled_end, status, appointment_type, tech_primary_name, tech_all_names, customer_name, street, city, total_amount, flags")
      .gte("scheduled_start", startUtc)
      .lt("scheduled_start", endDate)
      // Hide cancelled — they shouldn't appear on the dispatch view (per Danny 2026-05-04
      // catching clint booker's cancelled jobs showing up on Today)
      .not("status", "in", '("pro canceled","user canceled","cancelled","canceled","Pro Canceled","User Canceled","Cancelled","Canceled")')
      // Hide internal "TPAR" jobs to match the rest of the dashboard's filtering
      .not("customer_name", "in", '("Tulsa Plumbing and Remodeling","TPAR","Spam","DMG","System")')
      .order("scheduled_start", { ascending: true }),
    supa
      .from("appointments_master")
      .select("appointment_id, hcp_job_id, hcp_customer_id, scheduled_start, status, tech_primary_name, customer_name, street, city")
      .lt("scheduled_start", sevenDaysAgo)
      .in("status", ["scheduled", "Scheduled", "needs scheduling", "Needs Scheduling"])
      .order("scheduled_start", { ascending: false })
      .limit(40),
  ]);

  const rows = (upcomingRes.data ?? []) as Appt[];
  const formerSet = await getFormerTechNames();
  const staleRows = (staleRes.data ?? []) as Array<{
    appointment_id: string | null;
    hcp_job_id: string | null;
    hcp_customer_id: string | null;
    scheduled_start: string;
    status: string | null;
    tech_primary_name: string | null;
    customer_name: string | null;
    street: string | null;
    city: string | null;
  }>;

  // Group by Chicago-local date key.
  const grouped = new Map<string, Appt[]>();
  for (const r of rows) {
    const key = chicagoDateKey(r.scheduled_start);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }
  const groupKeys = Array.from(grouped.keys()).sort();

  const totalCount = rows.length;
  const techCount = new Set(rows.map((r) => r.tech_primary_name).filter(Boolean)).size;
  const today = nowCtKey;
  const todayCount = grouped.get(today)?.length ?? 0;

  return (
    <PageShell
      title="Dispatch"
      description={`${totalCount} appointment${totalCount === 1 ? "" : "s"} across ${techCount} tech${techCount === 1 ? "" : "s"} in the next 7 days · ${todayCount} today`}
    >
      {staleRows.length > 0 && (
        <details className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-amber-900">
            Stale: {staleRows.length} appointment{staleRows.length === 1 ? "" : "s"} more than 7 days past with status still &quot;scheduled&quot; / &quot;needs scheduling&quot;
            <span className="ml-2 font-normal text-amber-900/70">(click to expand)</span>
          </summary>
          <ul className="mt-3 space-y-1 text-sm">
            {staleRows.map((s) => {
              const ageDays = Math.round((Date.now() - new Date(s.scheduled_start).getTime()) / 86_400_000);
              return (
                <li key={s.appointment_id ?? s.hcp_job_id ?? s.scheduled_start} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-amber-900/70">{ageDays}d ago</span>
                  {s.hcp_job_id ? (
                    <Link href={`/job/${s.hcp_job_id}`} className="font-medium text-amber-900 hover:underline">{s.customer_name ?? "—"}</Link>
                  ) : (
                    <span className="font-medium text-amber-900">{s.customer_name ?? "—"}</span>
                  )}
                  <span className="text-xs text-amber-900/70">
                    · {s.tech_primary_name ?? "—"}
                    {s.street ? ` · ${s.street}${s.city ? ", " + s.city : ""}` : ""}
                    · status: {s.status}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-amber-900/70">
            Each row needs to be either rescheduled / completed / cancelled in HCP.
            This list is descriptive — no auto-action.
          </p>
        </details>
      )}

      {groupKeys.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          No appointments scheduled in the next 7 days.
        </div>
      ) : (
        <div className="space-y-6">
          {groupKeys.map((key) => {
            const dayRows = grouped.get(key)!;
            // appointments_master.total_amount is stored in CENTS (HCP native) — divide for display
            const dayTotal = dayRows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0) / 100;
            const dayTechs = new Set(dayRows.map((r) => r.tech_primary_name).filter(Boolean));
            return (
              <section key={key}>
                <header className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-base font-semibold text-neutral-900">
                    {chicagoDateLabel(key)}
                    <span className="ml-2 text-xs font-normal text-neutral-500">{key}</span>
                  </h2>
                  <div className="text-xs text-neutral-500">
                    {dayRows.length} appt{dayRows.length === 1 ? "" : "s"} · {dayTechs.size} tech{dayTechs.size === 1 ? "" : "s"}
                    {dayTotal > 0 ? ` · ${fmtMoney(dayTotal)}` : ""}
                  </div>
                </header>
                <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="border-b border-neutral-200 bg-neutral-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-neutral-600">Time</th>
                        <th className="px-4 py-2 text-left font-medium text-neutral-600">Tech</th>
                        <th className="px-4 py-2 text-left font-medium text-neutral-600">Customer</th>
                        <th className="px-4 py-2 text-left font-medium text-neutral-600">Address</th>
                        <th className="px-4 py-2 text-left font-medium text-neutral-600">Type</th>
                        <th className="px-4 py-2 text-left font-medium text-neutral-600">Status</th>
                        <th className="px-4 py-2 text-right font-medium text-neutral-600">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {dayRows.map((r) => {
                        const href = r.hcp_job_id ? `/job/${r.hcp_job_id}` : null;
                        const cells = (
                          <>
                            <td className="px-4 py-2 align-top whitespace-nowrap font-mono text-xs text-neutral-700">
                              {chicagoTime(r.scheduled_start)}
                            </td>
                            <td className="px-4 py-2 align-top">
                              <div className="font-medium text-neutral-900">
                                <TechName name={r.tech_primary_name} formerSet={formerSet} />
                              </div>
                              {r.tech_all_names && r.tech_all_names.length > 1 ? (
                                <div className="text-xs text-neutral-500">+{r.tech_all_names.length - 1} other</div>
                              ) : null}
                            </td>
                            <td className="px-4 py-2 align-top">
                              {r.hcp_customer_id ? (
                                <Link
                                  href={`/customer/${r.hcp_customer_id}`}
                                  className="font-medium text-neutral-900 hover:underline"
                                >
                                  {r.customer_name ?? "—"}
                                </Link>
                              ) : (
                                <span className="font-medium text-neutral-900">{r.customer_name ?? "—"}</span>
                              )}
                            </td>
                            <td className="px-4 py-2 align-top text-neutral-700">
                              {[r.street, r.city].filter(Boolean).join(", ") || "—"}
                            </td>
                            <td className="px-4 py-2 align-top text-xs text-neutral-600">
                              {r.appointment_type ?? "—"}
                            </td>
                            <td className="px-4 py-2 align-top">
                              <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${statusTone(r.status)}`}>
                                {r.status ?? "—"}
                              </span>
                            </td>
                            <td className="px-4 py-2 align-top text-right font-medium text-neutral-700">
                              {(Number(r.total_amount) || 0) > 0 ? fmtMoney((Number(r.total_amount) || 0) / 100) : ""}
                            </td>
                          </>
                        );
                        if (href) {
                          return (
                            <tr key={r.appointment_id ?? r.hcp_job_id ?? Math.random()} className="hover:bg-neutral-50">
                              {cells}
                            </tr>
                          );
                        }
                        return <tr key={r.appointment_id ?? Math.random()}>{cells}</tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
