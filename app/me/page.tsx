// /me — tech-default landing page. Shows the signed-in tech their own
// lane: today's appointments, recent comms, vehicle status, KPI snapshot.
//
// Per-tech auth + scoped views v0 (2026-05-01). v1 will extend with:
//   - "My customers" filter on /customers
//   - "My jobs" filter on /jobs
//   - "My comms" filter on /comms
//   - PIP per-tech metrics rendered visually

import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "../../lib/supabase";
import { getCurrentTech } from "../../lib/current-tech";
import { PageShell } from "../../components/PageShell";

export const metadata = { title: "My day · TPAR-DB" };

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return s.slice(0, 10);
}

export default async function MyPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/me");
  // If signed-in but not a tech, gently redirect to /
  if (!me.tech) redirect("/?msg=not_a_tech");

  const techName = me.tech.tech_short_name;
  const supa = db();
  const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [apptsRes, commsRes, vehicleRes, kpiRes] = await Promise.all([
    // Today's appointments where this tech is primary
    supa
      .from("appointment_location_v")
      .select("appointment_id, hcp_job_id, scheduled_start, scheduled_start_chicago, customer_name, street, city, zip, status, total_amount")
      .eq("tech_primary_name", techName)
      .gte("appt_date_chicago", today)
      .lte("appt_date_chicago", today)
      .order("scheduled_start"),
    // Recent comms attributed to this tech
    supa
      .from("communication_events")
      .select("id, occurred_at, channel, direction, customer_name, importance, sentiment, flags, summary")
      .eq("tech_short_name", techName)
      .order("occurred_at", { ascending: false })
      .limit(15),
    // Vehicle assigned to this tech
    supa
      .from("vehicles_current_v")
      .select("display_name, kind, estimated_current_odometer, last_known_odometer, days_since_oil_change, days_since_any_service, notes")
      .eq("driver", techName)
      .eq("is_active", true)
      .maybeSingle(),
    // KPI snapshot from existing per-tech view
    supa
      .from("tech_kpi_current_v1")
      .select("*")
      .eq("tech_name", techName)
      .maybeSingle(),
  ]);

  const appts = (apptsRes.data ?? []) as Array<Record<string, unknown>>;
  const comms = (commsRes.data ?? []) as Array<Record<string, unknown>>;
  const vehicle = vehicleRes.data as Record<string, unknown> | null;
  const kpi = kpiRes.data as Record<string, unknown> | null;

  return (
    <PageShell
      title={`Hi, ${techName}`}
      description={`Your day. ${appts.length} appointment${appts.length === 1 ? "" : "s"} today.`}
    >
      {/* Today's appointments */}
      <section className="mb-8">
        <h2 className="mb-3 text-base font-semibold text-neutral-800">Today&apos;s appointments</h2>
        {appts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
            No appointments scheduled for you today.
          </div>
        ) : (
          <ul className="space-y-2">
            {appts.map((a) => (
              <li key={a.appointment_id as string} className="rounded-2xl border border-neutral-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/job/${a.hcp_job_id}`} className="font-medium text-neutral-900 hover:underline">
                    {(a.customer_name as string) ?? "(no name)"}
                  </Link>
                  <span className="text-xs text-neutral-500">
                    {fmtTime(a.scheduled_start as string)} · {(a.status as string) ?? "?"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-neutral-600">
                  {[a.street, a.city, a.zip].filter(Boolean).join(", ")}
                </div>
                {a.total_amount && Number(a.total_amount) > 0 ? (
                  <div className="mt-1 text-xs text-emerald-700">
                    Quoted: ${Number(a.total_amount).toLocaleString()}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Vehicle */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-neutral-800">My vehicle</h2>
          {vehicle ? (
            <div className="rounded-2xl border border-neutral-200 bg-white p-4">
              <div className="font-medium text-neutral-900">{vehicle.display_name as string}</div>
              <div className="text-xs text-neutral-500">{vehicle.kind as string}</div>
              {vehicle.estimated_current_odometer ? (
                <div className="mt-2 text-sm text-neutral-700">
                  Odometer (est): <span className="font-medium">{(vehicle.estimated_current_odometer as number).toLocaleString()}</span> mi
                </div>
              ) : null}
              {vehicle.days_since_oil_change != null ? (
                <div className={`mt-1 text-xs ${(vehicle.days_since_oil_change as number) > 180 ? "text-red-700 font-medium" : (vehicle.days_since_oil_change as number) > 90 ? "text-amber-700" : "text-emerald-700"}`}>
                  Last oil: {vehicle.days_since_oil_change as number} days ago
                </div>
              ) : (
                <div className="mt-1 text-xs text-neutral-400">Last oil: not tracked yet</div>
              )}
              {vehicle.notes ? (
                <div className="mt-2 text-xs italic text-neutral-500">{vehicle.notes as string}</div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
              No vehicle assigned. Ask Danny to assign one in /admin → tech directory.
            </div>
          )}
        </section>

        {/* KPI snapshot */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-neutral-800">My 30-day snapshot</h2>
          {kpi ? (
            <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <dt className="text-neutral-500">Jobs completed</dt>
                <dd className="text-right font-medium">{(kpi.jobs_completed_30d as number) ?? "—"}</dd>
                <dt className="text-neutral-500">Revenue</dt>
                <dd className="text-right font-medium">
                  {kpi.revenue_30d ? `$${Number(kpi.revenue_30d).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                </dd>
                <dt className="text-neutral-500">Avg ticket</dt>
                <dd className="text-right">
                  {kpi.avg_invoice_value_30d ? `$${Number(kpi.avg_invoice_value_30d).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                </dd>
                <dt className="text-neutral-500">On-time</dt>
                <dd className="text-right">{kpi.on_time_pct_30d != null ? `${Math.round(Number(kpi.on_time_pct_30d))}%` : "—"}</dd>
                <dt className="text-neutral-500">GPS match</dt>
                <dd className="text-right">{kpi.gps_match_pct_30d != null ? `${Math.round(Number(kpi.gps_match_pct_30d))}%` : "—"}</dd>
                <dt className="text-neutral-500">Avg time on-site</dt>
                <dd className="text-right">{kpi.avg_time_on_site_min != null ? `${Math.round(Number(kpi.avg_time_on_site_min))} min` : "—"}</dd>
              </dl>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
              No KPI snapshot yet for {techName}.
            </div>
          )}
        </section>
      </div>

      {/* Recent comms */}
      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-neutral-800">My recent comms (last 15)</h2>
        {comms.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
            No recent comms attributed to {techName}.
          </div>
        ) : (
          <ul className="space-y-2">
            {comms.slice(0, 10).map((c) => (
              <li key={c.id as number} className="rounded-2xl border border-neutral-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-neutral-500">
                  <span>
                    {fmtDate(c.occurred_at as string)} · <span className="uppercase">{c.channel as string}</span> · {c.direction as string}
                  </span>
                  {c.customer_name ? <span className="font-medium text-neutral-700">{c.customer_name as string}</span> : null}
                </div>
                <div className="mt-1 text-sm text-neutral-800">{(c.summary as string) ?? "(no summary)"}</div>
                {(c.flags as string[] | null)?.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(c.flags as string[]).map((f) => (
                      <span key={f} className="rounded-full bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">{f}</span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-xs text-neutral-500">
        v0 of per-tech scoped views. v1 will add &quot;My customers&quot;, &quot;My jobs&quot;, and &quot;My comms&quot; filters on the global pages, plus a personal PIP rollup.
      </p>
    </PageShell>
  );
}
