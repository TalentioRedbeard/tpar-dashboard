// Per-job 360 view — typed read via lib/typed-db (#120, 2026-05-04).
// The single supabase.from("job_360") call is gone; the typed getJob360()
// validates the row at the data boundary and surfaces compile-time
// completion for column access.
import { db } from "@/lib/supabase";
import Link from "next/link";
import { NoteForm } from "../../../components/NoteForm";
import { addJobNote } from "../../../lib/notes-actions";
import { getNeedsForJob } from "../../shopping/actions";
import { listVoiceNotesForJob } from "../../voice-notes/actions";
import { getFiredTriggersForJob } from "./trigger-actions";
import { getBriefingForJob } from "./briefing-actions";
import { listPinnedEmailsForJob } from "../../customer/[id]/email-actions";
import { TriggerForms } from "./TriggerForms";
import { JobBriefingCard } from "../../../components/JobBriefingCard";
import { PageShell } from "../../../components/PageShell";
import { getJob360, resolveJobIdentifier, jobRevenueDollars, jobDueDollars } from "@/lib/typed-db/job-360";
import { redirect } from "next/navigation";
import { fmtDollars } from "@/lib/typed-db/money";
import { Section } from "../../../components/ui/Section";
import { StatCard } from "../../../components/ui/StatCard";
import { Pill } from "../../../components/ui/Pill";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LinkButton } from "../../../components/ui/Button";
import { TechName } from "../../../components/ui/TechName";
import { ProvenanceCard, type ProvenanceItem } from "../../../components/ui/ProvenanceCard";
import { getCurrentTech } from "../../../lib/current-tech";
import { getFormerTechNames } from "../../../lib/former-techs";
import { RecordingPlayer } from "../../../components/RecordingPlayer";
import { LogReceiptForm } from "../../../components/LogReceiptForm";
import { EditJobPanel } from "../../../components/EditJobPanel";

export const dynamic = "force-dynamic";

type JobNote = {
  id: string;
  hcp_job_id: string;
  author_email: string;
  body: string;
  created_at: string;
};

function fmtMoney(n: unknown): string {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentTech().catch(() => null);
  const canWrite = !!me?.canWrite;
  const canEdit = !!(me?.isAdmin || me?.isManager); // MGMT — direct HCP edit
  const formerSet = await getFormerTechNames();
  const supabase = db();

  // Typed read — schema validation + compile-time column access (#120).
  // First try direct hcp_job_id lookup (the canonical case).
  let jobRow = await getJob360(id);

  // If no match, the URL slug may actually be an invoice/estimate number
  // (what techs see + share). Resolve and either redirect to the real
  // hcp_job_id or render a segment picker.
  if (!jobRow) {
    const resolved = await resolveJobIdentifier(id);
    if (resolved.kind === "hcp_id") {
      jobRow = resolved.row;
    } else if (resolved.kind === "invoice") {
      // Found exactly one job for this invoice trunk — redirect to its real
      // hcp_job_id URL so the address bar reflects the canonical identifier.
      const realId = (resolved.row as Record<string, unknown>).hcp_job_id as string | undefined;
      if (realId && realId !== id) {
        redirect(`/job/${realId}?from_invoice=${encodeURIComponent(id)}`);
      }
      jobRow = resolved.row;
    } else if (resolved.kind === "invoice_multiple") {
      // The invoice trunk has multiple segments (HCP splits big jobs into
      // -1, -2, -3 etc.). Show a picker so the tech can choose the right one.
      return (
        <PageShell
          kicker="Multiple matches"
          title={`Job #${resolved.trunk} has multiple segments`}
          backHref="/jobs"
          backLabel="All jobs"
        >
          <EmptyState
            title={`Pick the right segment of #${resolved.trunk}`}
            description={
              <>
                Invoice <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">{resolved.trunk}</code> has{" "}
                {resolved.rows.length} day-segments. Pick the one you mean — most-recent first.
              </>
            }
          />
          <ul className="mt-3 divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            {resolved.rows
              .slice()
              .sort((a, b) => {
                const da = (a as Record<string, unknown>).job_date as string | null;
                const db_ = (b as Record<string, unknown>).job_date as string | null;
                if (da && db_) return db_.localeCompare(da);
                return 0;
              })
              .map((row) => {
                const r = row as Record<string, unknown>;
                return (
                  <li key={r.hcp_job_id as string}>
                    <Link
                      href={`/job/${r.hcp_job_id}?from_invoice=${encodeURIComponent(id)}`}
                      className="block px-4 py-3 hover:bg-neutral-50"
                    >
                      <div className="font-medium text-neutral-900">
                        {(r.invoice_number as string) ?? "—"} · {(r.customer_name as string) ?? "—"}
                      </div>
                      <div className="text-xs text-neutral-600">
                        {(r.job_date as string) ?? "no date"} · {(r.appointment_status as string) ?? "no status"} · {(r.tech_primary_name as string) ?? "—"}
                      </div>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </PageShell>
      );
    } else {
      // Truly not found in our DB. Final fallback: live HCP estimate lookup.
      // /jobs has the same fallback (project_jobs_hcp_live_lookup_2026-05-05);
      // share the pattern. Only fires for digit-shaped inputs.
      if (/^\d{6,9}$/.test(id)) {
        const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
        const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
        if (SUPABASE_URL && SERVICE_KEY) {
          try {
            const r = await fetch(`${SUPABASE_URL}/functions/v1/resolve-hcp-estimate`, {
              method: "POST",
              headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ estimate_number: id }),
            });
            const data = await r.json().catch(() => null) as { ok?: boolean; hcp_job_id?: string | null } | null;
            if (data?.ok && data.hcp_job_id) {
              redirect(`/job/${data.hcp_job_id}?from_estimate=${encodeURIComponent(id)}`);
            }
          } catch {
            // Fall through to "not found"
          }
        }
      }
      return (
        <PageShell title="Job not found" backHref="/jobs" backLabel="All jobs">
          <EmptyState
            title="Couldn't find that job."
            description={
              <>
                <p>
                  Looked up <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">{id}</code>.
                  Tried direct hcp_job_id, invoice number (with HCP segment trunk match), and live HCP estimate lookup.
                </p>
                <p className="mt-2 text-xs text-neutral-600">
                  If you got here from a Slack link or someone&apos;s screenshot, the invoice/estimate may not be synced yet. Try{" "}
                  <Link href={`/jobs?q=${encodeURIComponent(id)}`} className="text-brand-700 hover:underline">searching /jobs</Link>.
                </p>
              </>
            }
          />
        </PageShell>
      );
    }
  }

  const j = jobRow as Record<string, unknown>;
  const customerId = j.hcp_customer_id as string | null;

  // Tech scope auth: techs only see jobs they were on (#130, per Danny 2026-05-04).
  // Admin/manager/production_manager bypass.
  // Note: job_360.tech_primary_name + tech_all_names store FULL names
  // (e.g., "Omar Fernandez"), not the short name.
  if (me && me.dashboardRole === "tech" && me.tech) {
    const techFullName = me.tech.hcp_full_name ?? me.tech.tech_short_name;
    const onPrimary = j.tech_primary_name === techFullName;
    const onCrew = Array.isArray(j.tech_all_names) && (j.tech_all_names as string[]).includes(techFullName);
    if (!onPrimary && !onCrew) {
      return (
        <PageShell kicker="Job" title="Outside your scope" backHref="/" backLabel="Today">
          <EmptyState
            title="You weren't on this job."
            description={
              <>
                For privacy + system safety, techs only see jobs they were on.
                If you need access, ask the production manager.
              </>
            }
          />
        </PageShell>
      );
    }
  }

  const [{ data: comms }, similarRes, notesRes, jobNeeds, firedTriggers, voiceNotes, briefing, pinnedForJob, provJobRawRes] = await Promise.all([
    customerId
      ? supabase
          .from("communication_events")
          .select("id, occurred_at, channel, direction, importance, sentiment, flags, tech_short_name, summary")
          .eq("hcp_customer_id", customerId)
          .order("occurred_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supabase.rpc("job_similar_to", { target_id: id, n: 6 }),
    supabase
      .from("job_notes")
      .select("id, hcp_job_id, author_email, body, created_at")
      .eq("hcp_job_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    getNeedsForJob(id),
    getFiredTriggersForJob(id),
    listVoiceNotesForJob(id),
    getBriefingForJob(id),
    listPinnedEmailsForJob(id, customerId),
    // Provenance probe — single hcp_jobs_raw row gives us last_synced_at +
    // whether HCP notes are present + the linked original_estimate_id.
    supabase.from("hcp_jobs_raw").select("last_synced_at, hcp_notes, original_estimate_id").eq("hcp_job_id", id).maybeSingle(),
  ]);

  // Resolve the linked estimate row if the job came from one.
  const linkedEstimateId = (provJobRawRes.data as { original_estimate_id?: string } | null)?.original_estimate_id ?? null;
  const linkedEstimateRes = linkedEstimateId
    ? await supabase.from("hcp_estimates_raw").select("hcp_estimate_id, last_synced_at, hcp_notes").eq("hcp_estimate_id", linkedEstimateId).maybeSingle()
    : { data: null };

  const jobRaw = provJobRawRes.data as { last_synced_at?: string; hcp_notes?: string | null; original_estimate_id?: string | null } | null;
  const estRaw = linkedEstimateRes.data as { hcp_estimate_id?: string; last_synced_at?: string; hcp_notes?: string | null } | null;
  const provenanceItems: ProvenanceItem[] = [
    {
      section: "Job record",
      source_fn: "hcp-webhook",
      tables: ["hcp_jobs_raw", "job_360"],
      last_ts: jobRaw?.last_synced_at ?? null,
      count: jobRaw ? 1 : 0,
    },
    ...(linkedEstimateId
      ? [{
          section: "Linked estimate",
          source_fn: "hcp-webhook",
          tables: ["hcp_estimates_raw"],
          last_ts: estRaw?.last_synced_at ?? null,
          count: estRaw ? 1 : 0,
          note: estRaw ? `${linkedEstimateId} (carries estimate-side notes the job inherited from)` : "estimate row missing despite link",
        } as ProvenanceItem]
      : []),
    {
      section: "Customer communications",
      source_fn: "hcp-webhook + transcribe-and-store-call + store-text-message + pull-gmail",
      tables: ["communication_events"],
      last_ts: (comms ?? [])[0]
        ? ((comms ?? [])[0] as { occurred_at?: string }).occurred_at ?? null
        : null,
      count: (comms ?? []).length,
    },
    {
      section: "HCP-mirrored notes",
      source_fn: "hcp-webhook",
      tables: ["hcp_jobs_raw.hcp_notes", "hcp_estimates_raw.hcp_notes"],
      last_ts: jobRaw?.last_synced_at ?? estRaw?.last_synced_at ?? null,
      count: ((jobRaw?.hcp_notes ? 1 : 0) + (estRaw?.hcp_notes ? 1 : 0)),
    },
    {
      section: "User-authored job notes",
      source_fn: "dashboard",
      tables: ["job_notes"],
      last_ts: (notesRes.data ?? [])[0]
        ? ((notesRes.data ?? [])[0] as { created_at?: string }).created_at ?? null
        : null,
      count: (notesRes.data ?? []).length,
    },
    {
      section: "Voice notes",
      source_fn: "voice-note-upload",
      tables: ["tech_voice_notes"],
      last_ts: (voiceNotes[0] as { ts?: string } | undefined)?.ts ?? null,
      count: voiceNotes.length,
    },
    {
      section: "Shopping needs",
      source_fn: "slack-need + dashboard",
      tables: ["needs_log"],
      last_ts: (jobNeeds[0] as { created_at?: string } | undefined)?.created_at ?? null,
      count: jobNeeds.length,
    },
    {
      section: "Fired triggers (OMW/Start/Finish/etc)",
      source_fn: "fire-trigger",
      tables: ["job_lifecycle_events"],
      last_ts: (firedTriggers[0] as { occurred_at?: string; fired_at?: string } | undefined)?.occurred_at
        ?? (firedTriggers[0] as { fired_at?: string } | undefined)?.fired_at
        ?? null,
      count: firedTriggers.length,
    },
  ];
  const notes = (notesRes.data ?? []) as JobNote[];
  const openJobNeeds = jobNeeds.filter((n) => n.status !== "fulfilled" && n.status !== "cancelled");

  // Job-page additions (Madisson meeting): surface recordings captured on this
  // job (the Record button already writes them, target_kind='job'), the 3-factor
  // Job Cost from job_cost_v2, and the itemized receipts that roll into it.
  const invoiceTrunk = String((j.invoice_number as string) ?? "").split("-")[0].trim();
  const [recordingsRes, jobCostRes, receiptsRes] = await Promise.all([
    supabase
      .from("recordings")
      .select("id, label, transcript, duration_ms, created_by, created_at")
      .eq("target_kind", "job").eq("target_ref", id)
      .order("created_at", { ascending: false }).limit(20),
    supabase
      .from("job_cost_v2")
      .select("materials_cost, receipts_cost, derived_labor_cost, derived_labor_minutes, derived_total_cost, derived_gross_margin_pct, margin_data_quality, burden_rate_used")
      .eq("hcp_job_id", id).maybeSingle(),
    invoiceTrunk
      ? supabase
          .from("receipts_master")
          .select("id, amount, vendor_description, transaction_date, tech_name, source, photo_url")
          .eq("is_overhead", false)
          .or(`invoice_number.eq.${invoiceTrunk},invoice_number.like.${invoiceTrunk}-%`)
          .order("transaction_date", { ascending: false, nullsFirst: false }).limit(50)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const recordings = (recordingsRes.data ?? []) as Array<{ id: string; label: string | null; transcript: string | null; duration_ms: number | null; created_by: string | null; created_at: string }>;
  const jobCost = (jobCostRes.data ?? null) as Record<string, unknown> | null;
  const receiptItems = (receiptsRes.data ?? []) as Array<{ id: number; amount: number; vendor_description: string | null; transaction_date: string | null; tech_name: string | null; source: string | null; photo_url: string | null }>;
  const receiptsTotal = receiptItems.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  // Edit-job panel data (#33) — only fetched for MGMT. The current slot gives us
  // the start time to prefill (job_360 only carries job_date), and the active
  // tech roster feeds the reassign dropdown.
  let editSlotStart: string | null = null;
  let editTechs: Array<{ full: string; short: string }> = [];
  if (canEdit) {
    const [slotRes, techsRes] = await Promise.all([
      supabase
        .from("appointments_master")
        .select("scheduled_start")
        .eq("hcp_job_id", id)
        .is("deleted_at", null)
        .order("scheduled_start", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("tech_directory")
        .select("hcp_full_name, tech_short_name")
        .eq("is_active", true)
        .not("hcp_employee_id", "is", null)
        .order("tech_short_name", { ascending: true }),
    ]);
    editSlotStart = (slotRes.data as { scheduled_start?: string } | null)?.scheduled_start ?? null;
    editTechs = ((techsRes.data ?? []) as Array<{ hcp_full_name: string | null; tech_short_name: string | null }>)
      .filter((t) => t.hcp_full_name)
      .map((t) => ({ full: t.hcp_full_name as string, short: t.tech_short_name ?? (t.hcp_full_name as string) }));
  }
  const editCurrentTime = editSlotStart
    ? new Date(editSlotStart).toLocaleTimeString("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false }).slice(0, 5)
    : null;

  const addressLine = [j.street as string, j.city as string].filter(Boolean).join(", ");
  const description = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {addressLine ? <span>{addressLine}</span> : null}
      <span className="font-mono text-xs text-neutral-500">{id}</span>
      {customerId ? (
        <Link href={`/customer/${customerId}`} className="text-brand-700 hover:underline">
          customer 360 →
        </Link>
      ) : null}
    </span>
  );

  return (
    <PageShell
      kicker="Job"
      title={(j.customer_name as string) ?? id}
      description={description}
      backHref="/jobs"
      backLabel="All jobs"
      help={{
        intent: "Everything tied to this one job. Trigger buttons (OMW/Start/Finish), notes, photos, voice notes, the estimate, the customer's other history.",
        actions: [
          "Trigger pills (top): OMW when leaving, Start when on-site, Finish when done. HCP + customer notifications fire automatically.",
          "Add a job note when the customer says something Danny should know later. They show on this page + the customer page.",
          "Voice notes: tap, talk, walk away. Auto-transcribed; we use them to build estimates.",
          "+ Multi-option estimate opens the estimate builder if the scope grew on-site.",
          "Customer 360 link top-right takes you to everything we know about THIS customer.",
        ],
        stuck: <>Trigger button doesn&apos;t change color? Wait 10 sec then refresh. Still stuck — text Danny with the job number.</>,
      }}
      actions={
        canWrite ? (
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/job/${id}/estimate/new`} variant="primary">
              + Multi-option estimate
            </LinkButton>
            {customerId ? (
              <LinkButton href={`/membership/enroll?customer=${customerId}&job=${id}`} variant="secondary">
                + Add membership
              </LinkButton>
            ) : null}
          </div>
        ) : null
      }
    >
      <JobBriefingCard hcpJobId={id} briefing={briefing} pinnedEmails={pinnedForJob} />
      <div className="space-y-10">
        {canEdit ? (
          <div className="-mt-2">
            <EditJobPanel
              hcpJobId={id}
              currentDate={(j.job_date as string) ?? null}
              currentTime={editCurrentTime}
              currentTechFull={(j.tech_primary_name as string) ?? null}
              techs={editTechs}
            />
          </div>
        ) : null}

        <Section title="At a glance">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Date" value={(j.job_date as string) ?? "—"} />
            <StatCard label="Tech" value={<TechName name={j.tech_primary_name as string | null} formerSet={formerSet} />} />
            <StatCard label="Status" value={(j.appointment_status as string) ?? (j.status as string) ?? "—"} />
            <StatCard label="Crew size" value={(j.crew_size as number) ?? "—"} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Revenue" value={fmtMoney(j.revenue)} tone="brand" />
            <StatCard label="Materials" value={fmtMoney(j.materials_cost)} />
            <StatCard
              label="Gross margin"
              value={j.gross_margin_pct != null ? `${Number(j.gross_margin_pct).toFixed(0)}%` : "—"}
              tone={Number(j.gross_margin_pct) >= 50 ? "green" : Number(j.gross_margin_pct) < 30 ? "amber" : "neutral"}
            />
            <StatCard label="Receipts cost" value={fmtMoney(j.receipts_cost)} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="GPS matched" value={j.gps_matched ? "yes" : "no"} tone={j.gps_matched ? "green" : "neutral"} />
            <StatCard
              label="On time"
              value={j.on_time === true ? "yes" : j.on_time === false ? "late" : "—"}
              tone={j.on_time === false ? "amber" : j.on_time === true ? "green" : "neutral"}
            />
            <StatCard label="Min on site" value={(j.time_on_site_minutes as number) ?? "—"} />
            <StatCard label="Min early" value={(j.minutes_early as number) ?? "—"} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Comms (this job)" value={(j.comm_count_for_job as number) ?? 0} />
            <StatCard label="Comms 30d window" value={(j.comm_count_customer_30d_window as number) ?? 0} />
            <StatCard
              label="Open follow-ups (cust)"
              value={(j.open_followups_for_customer as number) ?? 0}
              tone={Number(j.open_followups_for_customer) > 0 ? "amber" : "neutral"}
            />
            <StatCard label="Photos" value={(j.photo_count as number) ?? 0} />
          </div>
        </Section>

        <Section
          title="Job cost"
          description="Three factors: HCP line-item materials + logged receipts + GPS-derived labor. Receipts attach by invoice number."
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Materials (HCP)" value={fmtMoney((jobCost?.materials_cost as number) ?? j.materials_cost)} />
            <StatCard label="Receipts" value={fmtMoney((jobCost?.receipts_cost as number) ?? j.receipts_cost)} />
            <StatCard label="Labor (GPS-derived)" value={fmtMoney(jobCost?.derived_labor_cost)} />
            <StatCard label="Est. total cost" value={fmtMoney(jobCost?.derived_total_cost)} />
          </div>
          {jobCost?.derived_labor_cost == null ? (
            <p className="mt-2 text-xs text-neutral-500">GPS-derived labor isn&apos;t available for this job yet (needs matched trips + on-site time).</p>
          ) : (
            <p className="mt-2 text-xs text-neutral-500">
              Labor estimate quality: {String(jobCost?.margin_data_quality ?? "—")}
              {jobCost?.derived_gross_margin_pct != null ? ` · est. margin ${Number(jobCost.derived_gross_margin_pct).toFixed(0)}%` : ""}
              {jobCost?.burden_rate_used != null ? ` · burden ${fmtMoney(jobCost.burden_rate_used)}/hr` : ""}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-neutral-800">
              Receipts · {fmtMoney(receiptsTotal)}{receiptItems.length ? ` (${receiptItems.length})` : ""}
            </h4>
          </div>
          {receiptItems.length > 0 ? (
            <ul className="mt-2 divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              {receiptItems.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-neutral-800">{r.vendor_description ?? "—"}</span>
                    <span className="ml-2 text-xs text-neutral-500">
                      {r.transaction_date ?? ""}{r.tech_name ? ` · ${r.tech_name}` : ""}{r.source ? ` · ${r.source}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-neutral-900">{fmtMoney(r.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-neutral-500">
              No receipts logged yet{j.invoice_number ? "" : " — this job has no invoice number to attach to"}.
            </p>
          )}
          {canWrite && j.invoice_number ? (
            <div className="mt-3">
              <LogReceiptForm invoiceNumber={String(j.invoice_number)} jobId={id} />
            </div>
          ) : null}
        </Section>

        {Array.isArray(j.topics_in_window) && (j.topics_in_window as string[]).length > 0 && (
          <Section title="Topics in 14-day window">
            <div className="flex flex-wrap gap-1.5">
              {(j.topics_in_window as string[]).map((t) => (
                <Pill key={t} tone="slate">{t}</Pill>
              ))}
            </div>
          </Section>
        )}

        {Number(j.salesask_recording_count) > 0 && (
          <Section
            title="SalesAsk intake conversation"
            description="What the customer said, pre-extracted by SalesAsk. Use this to inform option structure, work descriptions, and pricing."
          >
            <div className="rounded-2xl border border-neutral-200 bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <span className="font-mono">{(j.salesask_latest_recording_name as string) ?? "—"}</span>
                {j.salesask_latest_recorded_at ? (
                  <>
                    <span>·</span>
                    <span>
                      {new Date(j.salesask_latest_recorded_at as string).toLocaleString("en-US", {
                        timeZone: "America/Chicago",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </>
                ) : null}
                {j.salesask_latest_match_method ? (
                  <>
                    <span>·</span>
                    <Pill
                      tone={
                        j.salesask_latest_match_method === "invoice_number_exact"
                          ? "green"
                          : Number(j.salesask_latest_match_confidence) >= 0.7
                          ? "brand"
                          : "amber"
                      }
                    >
                      {j.salesask_latest_match_method as string} {Number(j.salesask_latest_match_confidence).toFixed(1)}
                    </Pill>
                  </>
                ) : null}
                {Number(j.salesask_recording_count) > 1 ? (
                  <>
                    <span>·</span>
                    <span>{j.salesask_recording_count as number} recordings on file</span>
                  </>
                ) : null}
                {j.salesask_latest_url_mp3 ? (
                  <a
                    href={j.salesask_latest_url_mp3 as string}
                    target="_blank"
                    rel="noopener"
                    className="ml-auto rounded-md bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-100"
                  >
                    Open audio →
                  </a>
                ) : null}
              </div>

              {j.salesask_latest_scope_notes ? (
                <div className="mb-3">
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Scope</div>
                  <p className="whitespace-pre-line text-sm text-neutral-800">{j.salesask_latest_scope_notes as string}</p>
                </div>
              ) : null}

              {j.salesask_latest_pricing_notes ? (
                <div className="mb-3">
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Pricing discussed</div>
                  <p className="whitespace-pre-line text-sm text-neutral-800">{j.salesask_latest_pricing_notes as string}</p>
                </div>
              ) : null}

              {j.salesask_latest_additional_notes ? (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Additional notes</div>
                  <p className="whitespace-pre-line text-sm text-neutral-800">{j.salesask_latest_additional_notes as string}</p>
                </div>
              ) : null}
            </div>
          </Section>
        )}

        <Section
          title="Voice notes"
          description="Tech-recorded context for this job. Use any as a Based-on… reference for line-item generation."
          action={
            <Link
              href={`/voice-notes/new?job=${id}`}
              className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800"
            >
              + Record / upload
            </Link>
          }
        >
          {voiceNotes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-600">
              No voice notes attached to this job yet. Record one to capture rich context (recommendation, decisions, what you saw on site) — then generate options/lines from it.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              {voiceNotes.map((vn: any) => (
                <li key={vn.id}>
                  <Link href={`/voice-notes/${vn.id}`} className="block px-4 py-3 hover:bg-neutral-50">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-neutral-500">
                      <span className="font-medium text-neutral-900">{vn.tech_short_name ?? vn.user_email ?? "—"}</span>
                      <span>{new Date(vn.ts).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-neutral-500">
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono">{vn.source}</span>
                      {vn.intent_tag ? <span className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-700">{vn.intent_tag}</span> : null}
                      {vn.audio_duration_seconds ? <span>{Math.round(vn.audio_duration_seconds)}s</span> : null}
                      {vn.transcription_status !== "transcribed" ? <span className="text-amber-700">{vn.transcription_status}</span> : null}
                    </div>
                    {vn.transcript ? (
                      <p className="mt-1.5 line-clamp-2 text-xs text-neutral-700">{(vn.transcript as string).slice(0, 280)}{(vn.transcript as string).length > 280 ? "…" : ""}</p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {Array.isArray(similarRes.data) && (similarRes.data as Array<Record<string, unknown>>).length > 0 && (() => {
          // Cosine over job embeddings sits ~0.5 for unrelated same-domain jobs;
          // a real match clears ~0.6. Hide weak ones and label strength so the
          // compressed band reads clearly.
          const FLOOR = 0.6;
          const rows = (similarRes.data as Array<Record<string, unknown>>).filter((r) => Number(r.similarity) >= FLOOR);
          const revenues = rows
            .map((r) => Number(r.revenue))
            .filter((v) => Number.isFinite(v) && v > 0);
          const avg = revenues.length > 0 ? revenues.reduce((a, b) => a + b, 0) / revenues.length : null;
          const strengthOf = (s: number): { label: string; tone: "green" | "brand" | "slate" } =>
            s >= 0.72 ? { label: "Strong", tone: "green" }
            : s >= 0.66 ? { label: "Related", tone: "brand" }
            : { label: "Loose", tone: "slate" };
          return (
            <Section
              title="Similar past jobs"
              description={
                rows.length > 0 && avg !== null
                  ? `Avg revenue ${fmtMoney(avg)} across ${revenues.length} priced job${revenues.length === 1 ? "" : "s"}.`
                  : undefined
              }
            >
              {rows.length === 0 ? (
                <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
                  No closely similar past jobs yet — nothing in the history strongly matches this job&apos;s work.
                </div>
              ) : (
                <ul className="space-y-2">
                  {rows.map((s) => {
                    const sim = Number(s.similarity);
                    const st = strengthOf(sim);
                    return (
                      <li key={s.hcp_job_id as string} className="rounded-2xl border border-neutral-200 bg-white p-3 transition hover:border-neutral-300 hover:shadow-sm">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <Link href={`/job/${s.hcp_job_id}`} className="font-medium text-neutral-900 hover:underline">
                            {(s.customer_name as string) ?? "(no name)"}
                          </Link>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                            <Pill tone={st.tone} mono>{st.label} · {sim.toFixed(2)}</Pill>
                            <span>{(s.job_date as string) ?? "no date"}</span>
                            <span>·</span>
                            <TechName name={s.tech_primary_name as string | null} formerSet={formerSet} />
                            <span>·</span>
                            <span className="font-medium text-neutral-700 tabular-nums">{fmtMoney(s.revenue)}</span>
                            {s.gross_margin_pct != null ? (
                              <>
                                <span>·</span>
                                <span>{Number(s.gross_margin_pct).toFixed(0)}% margin</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <p className="mt-1.5 max-w-3xl whitespace-pre-line text-xs italic text-neutral-600">
                          {((s.text_preview as string) ?? "").slice(0, 250)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          );
        })()}

        <Section
          title="Lifecycle triggers"
          description="Fire a trigger as you progress through the job. Records timestamp + form data + your attribution."
        >
          <TriggerForms
            hcpJobId={id}
            hcpCustomerId={customerId}
            appointmentId={null}
            firedTriggers={firedTriggers}
            canWrite={canWrite}
            briefing={briefing}
          />
          {firedTriggers.length > 0 && (
            <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50/50 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">Fired so far</div>
              <ul className="space-y-1 text-xs text-neutral-700">
                {firedTriggers.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">#{t.trigger_number}</span>
                    <span className="font-medium">{t.trigger_name}</span>
                    <span className="text-neutral-500">·</span>
                    <span>{t.fired_by ?? "—"}</span>
                    <span className="text-neutral-400">·</span>
                    <span className="text-neutral-500">
                      {new Date(t.fired_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section
          title="Procurement needs for this job"
          description={
            openJobNeeds.length > 0
              ? `${openJobNeeds.length} open · click "Add" to log another`
              : undefined
          }
        >
          {openJobNeeds.length > 0 ? (
            <ul className="space-y-2 mb-3">
              {openJobNeeds.map((n) => (
                <li key={n.id} className="rounded-2xl border border-neutral-200 bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill
                      tone={
                        n.urgency === "asap" ? "red" :
                        n.urgency === "today" ? "amber" :
                        n.urgency === "this_week" ? "brand" : "slate"
                      }
                    >
                      {n.urgency.replace("_", " ")}
                    </Pill>
                    <span className="font-medium">
                      {n.qty ? <span className="font-mono text-neutral-500 mr-1">{n.qty}×</span> : null}
                      {n.item_description}
                    </span>
                    <span className="text-xs text-neutral-500">· {n.submitted_by} · via {n.submitted_via}</span>
                  </div>
                  {n.notes ? <div className="mt-1 text-xs text-neutral-600 whitespace-pre-line">{n.notes}</div> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {canWrite ? (
            <LinkButton href={`/shopping?prefill_job=${id}`} variant="secondary">
              + Add need for this job
            </LinkButton>
          ) : null}
        </Section>

        <Section title="Operator notes">
          {canWrite ? (
            <div className="mb-3 rounded-2xl border border-neutral-200 bg-white p-4">
              <NoteForm
                action={addJobNote}
                hiddenFieldName="hcp_job_id"
                hiddenFieldValue={id}
                placeholder="Internal note about this job (not customer-facing)…"
                label="Add note"
              />
            </div>
          ) : (
            <div className="mb-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">
              Manager view — read-only. Notes can be added by Danny or a tech.
            </div>
          )}
          {notes.length > 0 ? (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                  <div className="mb-1 text-xs text-neutral-500">
                    {new Date(n.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                    <span className="mx-1.5">·</span>
                    {n.author_email}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-neutral-800">{n.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No notes yet." description="Add one above to keep context for the next visit." />
          )}
        </Section>

        {recordings.length > 0 ? (
          <Section title="Recordings" description="Voice notes captured on this job via the Record button. Playback is private (signed, expires).">
            <ul className="space-y-2">
              {recordings.map((r) => (
                <li key={r.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                  <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
                    <span>{new Date(r.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}</span>
                    {r.created_by ? <><span>·</span><span>{r.created_by}</span></> : null}
                    {r.duration_ms ? <><span>·</span><span>{Math.round(r.duration_ms / 1000)}s</span></> : null}
                    {r.label ? <><span>·</span><span className="font-medium text-neutral-700">{r.label}</span></> : null}
                    <span className="ml-auto"><RecordingPlayer id={r.id} /></span>
                  </div>
                  {r.transcript ? <p className="whitespace-pre-wrap text-sm text-neutral-800">{r.transcript}</p> : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section
          title="Recent communications for this customer"
          description="Calls, texts, and emails surrounding this appointment window."
        >
          {comms && comms.length > 0 ? (
            <ul className="space-y-2">
              {comms.map((m: Record<string, unknown>) => (
                <li key={m.id as number} className="rounded-2xl border border-neutral-200 bg-white p-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    <span className="font-mono">
                      {new Date(m.occurred_at as string).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                    </span>
                    <Pill tone="slate">{m.channel as string}</Pill>
                    {m.direction ? <Pill tone="slate">{m.direction as string}</Pill> : null}
                    {m.tech_short_name ? <span>· {m.tech_short_name as string}</span> : null}
                    <span className="ml-auto">imp {(m.importance as number) ?? "—"}</span>
                  </div>
                  <p className="text-sm text-neutral-800">{m.summary as string}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No communications." />
          )}
        </Section>

        <ProvenanceCard items={provenanceItems} />
      </div>
    </PageShell>
  );
}
