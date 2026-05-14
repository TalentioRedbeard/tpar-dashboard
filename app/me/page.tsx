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
import { ClockButton } from "../../components/ClockButton";
import { StartAppointmentButton } from "../../components/StartAppointmentButton";
import { ClockSuggestionBanner } from "../../components/ClockSuggestionBanner";
import { LifecycleButtons } from "../../components/LifecycleButtons";
import { getCurrentState as getClockState } from "../time/actions";
import { getPendingSuggestions } from "../time/suggestions";

export const metadata = { title: "My day · TPAR-DB" };

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return s.slice(0, 10);
}

export default async function MyPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/me");

  // Admin "view-as" override: ?as=<tech_short_name> renders that tech's lane.
  // Useful for QA + admin impersonation without changing identity.
  //
  // Two names are needed downstream — short and full — because the views split:
  //   - communication_events + vehicles_current_v.driver use SHORT name
  //   - appointment_location_v.tech_primary_name + tech_kpi_current_v1.tech_name use FULL name
  //   (per reference_tech_name_fields_2026-05-04.md)
  const sp = await searchParams;
  const asOverride = sp?.as?.trim() ?? "";
  let techName: string | null = null;
  let techFullName: string | null = null;
  let viewingAs: string | null = null;

  if (asOverride && me.isAdmin) {
    const supaCheck = db();
    const { data } = await supaCheck
      .from("tech_directory")
      .select("tech_short_name, hcp_full_name")
      .ilike("tech_short_name", asOverride)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.tech_short_name) {
      techName = data.tech_short_name as string;
      techFullName = (data.hcp_full_name as string | null) ?? null;
      viewingAs = techName;
    } else {
      techName = me.tech?.tech_short_name ?? null;
      techFullName = me.tech?.hcp_full_name ?? null;
    }
  } else {
    techName = me.tech?.tech_short_name ?? null;
    techFullName = me.tech?.hcp_full_name ?? null;
  }

  if (!techName) redirect("/?msg=not_a_tech");

  const supa = db();
  const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // For admin "view-as" picker, also fetch the active tech list. Filter
  // is_test=true rows in JS (postgrest's neq excludes NULL rows too).
  const techListRes = me.isAdmin
    ? supa.from("tech_directory").select("tech_short_name, is_test").eq("is_active", true).order("tech_short_name")
    : Promise.resolve({ data: null });

  // Hoisted from serial awaits into the Promise.all below so all I/O fans out
  // in parallel (clockState + suggestions used to add ~200-400ms serially
  // before the rest of the page started fetching).
  const clockStatePromise = !viewingAs && me.tech ? getClockState() : Promise.resolve(null);
  const suggestionsPromise = !viewingAs && me.tech ? getPendingSuggestions() : Promise.resolve([]);

  const [clockState, suggestions, apptsRes, commsRes, vehicleRes, kpiRes, techListResolved, lifecycleRes, mirrorLogsRes] = await Promise.all([
    clockStatePromise,
    suggestionsPromise,
    // Today's appointments where this tech is primary.
    // appointment_location_v.tech_primary_name = FULL name (e.g. "Danny Dunlop").
    // Match on tech_primary_name OR tech_all_names so HELPERS see the jobs
    // they're on, not just LEADS — discovered 2026-05-13 verify pass:
    // Landon was on Anthony's 3 jobs as crew + /me showed him 0 appts.
    // Same OR-pattern that /jobs already uses.
    //
    // hcp_customer_id filter excludes test-customer artifacts (Danny
    // testing functionality on his own customer record).
    supa
      .from("appointment_location_v")
      .select("appointment_id, hcp_job_id, hcp_customer_id, scheduled_start, scheduled_start_chicago, customer_name, street, city, zip, status, total_amount, tech_primary_name, tech_all_names")
      .or(`tech_primary_name.eq."${techFullName ?? techName}",tech_all_names.cs.{"${techFullName ?? techName}"}`)
      .gte("appt_date_chicago", today)
      .lte("appt_date_chicago", today)
      // Hide cancelled — they aren't on the books
      .not("status", "in", '("pro canceled","user canceled","cancelled","canceled","Pro Canceled","User Canceled","Cancelled","Canceled")')
      // Hide test-customer rows (seeded in public.test_customer_blocklist).
      // Pulled inline via a join would be cleaner but PostgREST doesn't
      // support EXISTS subqueries; the test set is tiny so just enumerate.
      .not("hcp_customer_id", "in", '("cus_9cf8cc5b02e1430a85288b034763cc19","cus_386a644b8054483788825c86c1b13b9c")')
      .order("scheduled_start"),
    // Recent comms attributed to this tech.
    // raw_metadata.attribution_source is included so the UI can flag inferred
    // attributions ('⌖') from confirmed ones (see 2026-05-13 backfill).
    supa
      .from("communication_events")
      .select("id, occurred_at, channel, direction, customer_name, importance, sentiment, flags, summary, raw_metadata")
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
    // KPI snapshot from existing per-tech view.
    // tech_kpi_current_v1.tech_name = FULL name.
    supa
      .from("tech_kpi_current_v1")
      .select("*")
      .eq("tech_name", techFullName ?? techName)
      .maybeSingle(),
    techListRes,
    // Lifecycle events fired today, grouped by appointment.
    // Used to show which trigger buttons have already been pressed.
    supa
      .from("job_lifecycle_events")
      .select("hcp_job_id, appointment_id, trigger_number, fired_at")
      .gte("fired_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .eq("fired_by", techName),
    // Recent HCP-mirror outcomes (last 24h) for this tech's jobs. Lets
    // LifecycleButtons render the pill ON MOUNT instead of waiting for a
    // re-fire to populate it — survives page refreshes.
    supa
      .from("maintenance_logs")
      .select("ts, level, context")
      .eq("source", "hcp-trigger-action")
      .gte("ts", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("ts", { ascending: false })
      .limit(200),
  ]);

  const appts = (apptsRes.data ?? []) as Array<Record<string, unknown>>;
  const comms = (commsRes.data ?? []) as Array<Record<string, unknown>>;
  const vehicle = vehicleRes.data as Record<string, unknown> | null;
  const kpi = kpiRes.data as Record<string, unknown> | null;
  const techList = ((techListResolved as { data: Array<{ tech_short_name: string; is_test?: boolean | null }> | null }).data ?? [])
    .filter((t) => t.is_test !== true)
    .map((t) => t.tech_short_name);

  // Look up invoice_number for today's appointment job_ids so the appointment
  // cards can show the tech-recognized identifier (per
  // feedback_job_id_vs_invoice_conundrum_2026-05-13: techs think in invoice
  // numbers, not hcp_job_ids). One small query — runs serially after appts
  // since we don't know the ids until the appts query resolves.
  const apptJobIds = (apptsRes.data ?? [])
    .map((a) => (a as Record<string, unknown>).hcp_job_id as string | null)
    .filter((id): id is string => Boolean(id));
  const invoiceByJob = new Map<string, string>();
  if (apptJobIds.length > 0) {
    const { data: invoiceRows } = await supa
      .from("job_360")
      .select("hcp_job_id, invoice_number")
      .in("hcp_job_id", apptJobIds);
    for (const row of (invoiceRows ?? []) as Array<{ hcp_job_id: string; invoice_number: string | null }>) {
      if (row.invoice_number) invoiceByJob.set(row.hcp_job_id, row.invoice_number);
    }
  }

  // Build map: hcp_job_id → list of trigger_numbers fired today
  const lifecycleByJob = new Map<string, number[]>();
  // Also track fired_at per (job, trigger) so we can correlate with mirror logs.
  const firedAtByJobTrigger = new Map<string, string>();
  for (const row of (lifecycleRes.data ?? []) as Array<{ hcp_job_id: string | null; trigger_number: number; fired_at: string }>) {
    if (!row.hcp_job_id) continue;
    const arr = lifecycleByJob.get(row.hcp_job_id) ?? [];
    arr.push(row.trigger_number);
    lifecycleByJob.set(row.hcp_job_id, arr);
    firedAtByJobTrigger.set(`${row.hcp_job_id}::${row.trigger_number}`, row.fired_at);
  }

  // Build initial mirror state per (job, trigger). LifecycleButtons uses this
  // to populate pills on mount — survives page refreshes (without polling).
  type InitialMirror = {
    fired_at: string;
    state: "pending" | "synced" | "failed";
    message?: string;
    elapsed_ms?: number;
  };
  const TRIGGER_TO_HCP_ACTION_MAP: Record<number, "on_my_way" | "start" | "finish" | undefined> = {
    2: "on_my_way", 3: "start", 6: "finish",
  };
  const mirrorLogs = (mirrorLogsRes.data ?? []) as Array<{ ts: string; level: string; context: Record<string, unknown> | null }>;
  const initialMirrorsByJob = new Map<string, Record<number, InitialMirror>>();
  for (const [job, triggers] of lifecycleByJob) {
    const perTrigger: Record<number, InitialMirror> = {};
    for (const trigger of triggers) {
      const action = TRIGGER_TO_HCP_ACTION_MAP[trigger];
      if (!action) continue;
      const firedAt = firedAtByJobTrigger.get(`${job}::${trigger}`);
      if (!firedAt) continue;
      // Find the most recent mirror log entry for this (job, action) AFTER fired_at
      const match = mirrorLogs.find((r) => {
        const c = r.context as { job_id?: string; action?: string } | null;
        if (!c) return false;
        return c.job_id === job && c.action === action && r.ts > firedAt;
      });
      if (!match) {
        // If fired_at is more than 5 min ago and we still have no log row,
        // treat as failed (the bot never ran or its log got lost).
        const ageMs = Date.now() - new Date(firedAt).getTime();
        perTrigger[trigger] = ageMs > 5 * 60 * 1000
          ? { fired_at: firedAt, state: "failed", message: "No mirror log found within 5 min of firing." }
          : { fired_at: firedAt, state: "pending" };
        continue;
      }
      const ctx = (match.context ?? {}) as { bot_response?: { success?: boolean; error?: string }; elapsed_ms?: number };
      const success = ctx.bot_response?.success;
      perTrigger[trigger] = success === false || match.level === "error"
        ? { fired_at: firedAt, state: "failed", message: ctx.bot_response?.error?.slice(0, 200), elapsed_ms: ctx.elapsed_ms }
        : { fired_at: firedAt, state: "synced", elapsed_ms: ctx.elapsed_ms };
    }
    if (Object.keys(perTrigger).length > 0) {
      initialMirrorsByJob.set(job, perTrigger);
    }
  }

  return (
    <PageShell
      title={`Hi, ${techName}`}
      description={`${viewingAs ? `(viewing as ${viewingAs}) ` : ""}Your day. ${appts.length} appointment${appts.length === 1 ? "" : "s"} today.`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/jobs?mine=1${viewingAs ? `&as=${encodeURIComponent(viewingAs)}` : ""}`}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            My jobs →
          </Link>
          <Link
            href={`/comms?mine=1${viewingAs ? `&as=${encodeURIComponent(viewingAs)}` : ""}`}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            My comms →
          </Link>
        </div>
      }
    >
      {viewingAs ? (
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm">
          <span className="text-amber-900">
            🎭 <strong>Admin view-as</strong> — rendering as <code className="rounded bg-white px-1 py-0.5">{viewingAs}</code>. They see this same data when they sign in.
          </span>
          <a href="/me" className="rounded-md bg-amber-200 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-300">
            Exit view-as
          </a>
        </div>
      ) : me.isAdmin && techList.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-2 text-xs">
          <span className="font-medium text-neutral-600">Admin view-as:</span>
          {techList.filter((n) => n !== techName).map((n) => (
            <a
              key={n}
              href={`/me?as=${encodeURIComponent(n)}`}
              className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-neutral-700 hover:bg-neutral-50"
            >
              {n}
            </a>
          ))}
        </div>
      ) : null}

      {/* Clock button — primary action when a tech opens their day */}
      {!viewingAs && me.tech && clockState ? (
        <section className="mb-8">
          <ClockButton
            initial={clockState}
            techShortName={me.tech.tech_short_name}
          />
        </section>
      ) : null}

      {/* Quick-action tiles for capture surfaces. Linked surfaces have the
          same gestures available standalone (without an active appointment) —
          useful for gas-station receipts, drive-time voice notes, etc. */}
      {!viewingAs && me.tech ? (
        <section className="mb-8">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Link
              href="/receipt"
              className="flex flex-col items-start gap-1 rounded-2xl border border-neutral-200 bg-white p-3 hover:border-brand-300 hover:bg-brand-50/30"
            >
              <span className="text-2xl" aria-hidden>🧾</span>
              <span className="text-sm font-semibold text-neutral-900">Receipt</span>
              <span className="text-xs text-neutral-600">Snap a photo + log details</span>
            </Link>
            <Link
              href="/voice-notes/new"
              className="flex flex-col items-start gap-1 rounded-2xl border border-neutral-200 bg-white p-3 hover:border-brand-300 hover:bg-brand-50/30"
            >
              <span className="text-2xl" aria-hidden>🎙️</span>
              <span className="text-sm font-semibold text-neutral-900">Voice note</span>
              <span className="text-xs text-neutral-600">Record or upload audio</span>
            </Link>
            <Link
              href="/jobs"
              className="flex flex-col items-start gap-1 rounded-2xl border border-neutral-200 bg-white p-3 hover:border-brand-300 hover:bg-brand-50/30"
            >
              <span className="text-2xl" aria-hidden>📋</span>
              <span className="text-sm font-semibold text-neutral-900">Jobs</span>
              <span className="text-xs text-neutral-600">Look up + estimate</span>
            </Link>
            <Link
              href="/ask"
              className="flex flex-col items-start gap-1 rounded-2xl border border-neutral-200 bg-white p-3 hover:border-brand-300 hover:bg-brand-50/30"
            >
              <span className="text-2xl" aria-hidden>💬</span>
              <span className="text-sm font-semibold text-neutral-900">Ask</span>
              <span className="text-xs text-neutral-600">Search the system</span>
            </Link>
          </div>
        </section>
      ) : null}

      {/* Geofence-driven clock-in suggestions */}
      {suggestions.length > 0 && (
        <section className="mb-8 space-y-2">
          {suggestions.map((s) => (
            <ClockSuggestionBanner key={s.id} suggestion={s} />
          ))}
        </section>
      )}

      {/* Today's appointments */}
      <section className="mb-8">
        <h2 className="mb-3 text-base font-semibold text-neutral-800">Today&apos;s appointments</h2>
        {appts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
            No appointments scheduled for you today.
          </div>
        ) : (
          <ul className="space-y-2">
            {appts.map((a) => {
              const apptId = a.appointment_id as string | null;
              const jobId = (a.hcp_job_id as string | null) ?? null;
              const isHere =
                !!clockState &&
                clockState.state === "clocked-in" &&
                clockState.hcp_appointment_id === apptId;
              const isElsewhere =
                !!clockState && clockState.state === "clocked-in" && !isHere;
              return (
                <li key={apptId ?? "(no-id)"} className={"rounded-2xl border bg-white p-4 " + (isHere ? "border-emerald-300" : "border-neutral-200")}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      {jobId ? (
                        <Link href={`/job/${jobId}`} className="font-medium text-neutral-900 hover:underline">
                          {(a.customer_name as string) ?? "(no name)"}
                        </Link>
                      ) : (
                        // Estimate-only appointment (csr_...) — no underlying hcp_job_id
                        // yet. Render the name without a link rather than /job/null.
                        <span className="font-medium text-neutral-900">
                          {(a.customer_name as string) ?? "(no name)"}
                        </span>
                      )}
                      {/* If tech is on the crew but not the primary lead, badge it
                          so they know they're helping (not leading). Surfaced 2026-05-13:
                          /me used to filter only on primary, hiding crew assignments. */}
                      {techFullName && a.tech_primary_name !== techFullName ? (
                        <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200" title={`Lead: ${a.tech_primary_name ?? "—"}`}>
                          as helper
                        </span>
                      ) : null}
                    </div>
                    <span className="text-xs text-neutral-500">
                      {fmtTime(a.scheduled_start as string)} · {(a.status as string) ?? "?"}
                    </span>
                  </div>
                  {/* Show invoice number prominently — that's what techs see + share. */}
                  {jobId && invoiceByJob.get(jobId) ? (
                    <div className="mt-0.5 text-xs">
                      <span className="text-neutral-500">Job </span>
                      <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-neutral-700">#{invoiceByJob.get(jobId)}</code>
                    </div>
                  ) : !jobId ? (
                    // Estimate-only — surface that so tech knows the job
                    // hasn't been created yet (no invoice number, no lifecycle
                    // buttons, no Start). They likely need to create the job
                    // in HCP or via /estimate-draft first.
                    <div className="mt-0.5 text-[11px] text-amber-700">
                      Estimate-only — job not created yet in HCP
                    </div>
                  ) : null}
                  <div className="mt-1 text-xs text-neutral-600">
                    {[a.street, a.city, a.zip].filter(Boolean).join(", ")}
                  </div>
                  {a.total_amount && Number(a.total_amount) > 0 ? (
                    <div className="mt-1 text-xs text-emerald-700">
                      {/* appointments_master.total_amount is stored in cents — divide for display */}
                      Quoted: ${(Number(a.total_amount) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                  ) : null}
                  {!viewingAs && me.tech && (
                    <div className="mt-2.5">
                      <StartAppointmentButton
                        appointmentId={apptId}
                        jobId={jobId}
                        isClockedInHere={isHere}
                        isClockedInElsewhere={isElsewhere}
                      />
                    </div>
                  )}
                  {!viewingAs && me.tech && jobId && (
                    <LifecycleButtons
                      hcpJobId={jobId}
                      hcpAppointmentId={apptId}
                      firedTriggers={lifecycleByJob.get(jobId) ?? []}
                      initialMirrors={initialMirrorsByJob.get(jobId) ?? {}}
                    />
                  )}
                </li>
              );
            })}
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
                    {(c.raw_metadata as { attribution_source?: string } | null)?.attribution_source === "inferred_from_nearest_appointment" && (
                      <span
                        className="ml-1 text-amber-600"
                        title="Attribution inferred from the nearest job assignment — not confirmed via caller identity."
                      >
                        ⌖
                      </span>
                    )}
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
