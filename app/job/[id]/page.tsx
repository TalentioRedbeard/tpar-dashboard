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
import { AddJobLineItem } from "../../../components/AddJobLineItem";
import { RefreshFromHcpButton } from "../../../components/RefreshFromHcpButton";
import { CostToDatePanel } from "../../../components/CostToDatePanel";
import { PageShell } from "../../../components/PageShell";
import { getJob360, resolveJobIdentifier, jobRevenueDollars, jobDueDollars } from "@/lib/typed-db/job-360";
import { redirect } from "next/navigation";
import { fmtDollars } from "@/lib/typed-db/money";
import { Section } from "../../../components/ui/Section";
import { ScrollPanel } from "../../../components/ui/ScrollPanel";
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
import { JobMediaGallery } from "../../../components/JobMediaGallery";
import { JobSiteCard } from "../../../components/JobSiteCard";
import { WorklistCard } from "../../../components/WorklistCard";
import { MaterialsUsedCard } from "../../../components/MaterialsUsedCard";
import { getJobTasks } from "../../../lib/job-tasks";
import { getMaterialsUsedForJob } from "../../../lib/materials-actions";

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
  // Techs get bounced from /jobs to /me; send them to /find instead (#36).
  const techBackHref = me?.dashboardRole === "tech" ? "/find" : "/jobs";
  const techBackLabel = me?.dashboardRole === "tech" ? "Find a job" : "All jobs";
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
          backHref={techBackHref}
          backLabel={techBackLabel}
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
        <PageShell title="Job not found" backHref={techBackHref} backLabel={techBackLabel}>
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
                  {me?.dashboardRole === "tech" ? (
                    <Link href={`/find?q=${encodeURIComponent(id)}`} className="text-brand-700 hover:underline">searching for the job</Link>
                  ) : (
                    <Link href={`/jobs?q=${encodeURIComponent(id)}`} className="text-brand-700 hover:underline">searching /jobs</Link>
                  )}.
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
                If you should have access to this job, text Danny the job number and he&apos;ll add you.
              </>
            }
          />
        </PageShell>
      );
    }
  }

  const [{ data: comms }, notesRes, jobNeeds, firedTriggers, voiceNotes, briefing, pinnedForJob, provJobRawRes] = await Promise.all([
    customerId
      ? supabase
          .from("communication_events")
          .select("id, occurred_at, channel, direction, importance, sentiment, flags, tech_short_name, summary")
          .eq("hcp_customer_id", customerId)
          .order("occurred_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
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
    supabase.from("hcp_jobs_raw").select("last_synced_at, hcp_notes, original_estimate_id, status").eq("hcp_job_id", id).maybeSingle(),
  ]);

  // Resolve the linked estimate row if the job came from one.
  const linkedEstimateId = (provJobRawRes.data as { original_estimate_id?: string } | null)?.original_estimate_id ?? null;
  const linkedEstimateRes = linkedEstimateId
    ? await supabase.from("hcp_estimates_raw").select("hcp_estimate_id, last_synced_at, hcp_notes").eq("hcp_estimate_id", linkedEstimateId).maybeSingle()
    : { data: null };

  const jobRaw = provJobRawRes.data as { last_synced_at?: string; hcp_notes?: string | null; original_estimate_id?: string | null; status?: string | null } | null;
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

  // Multi-day "plumbing project" (#30): segments share an invoice trunk with -N
  // suffixes. HCP has no native multi-day model — the trunk IS the project.
  const projectRes = invoiceTrunk
    ? await supabase
        .from("job_project_v")
        .select("hcp_job_id, invoice_number, seg_no, status, scheduled_start, project_segment_count")
        .eq("trunk", invoiceTrunk)
        .order("seg_no", { ascending: true, nullsFirst: true })
    : { data: [] as Record<string, unknown>[] };
  const projectSegments = (projectRes.data ?? []) as Array<{ hcp_job_id: string; invoice_number: string | null; seg_no: number | null; status: string | null; scheduled_start: string | null; project_segment_count: number }>;
  const isProject = projectSegments.length > 1;

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
  // Turn-by-turn deep link (free Maps URL, not the paid Directions API).
  const directionsUrl = addressLine
    ? `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(addressLine)}`
    : null;

  // Job-site geo (map pin + Street View) + client phone (gated click-to-call).
  const [siteRes, phoneRes, apptRes] = await Promise.all([
    db()
      .from("appointments_master")
      .select("geo_lat, geo_lng")
      .eq("hcp_job_id", id)
      .not("geo_lat", "is", null)
      .order("scheduled_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db().from("jobs_master").select("phone10, job_description").eq("hcp_job_id", id).maybeSingle(),
    db()
      .from("appointments_master")
      .select("scheduled_start")
      .eq("hcp_job_id", id)
      .is("deleted_at", null)
      .order("scheduled_start", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const siteLat = (siteRes.data?.geo_lat as number | null) ?? null;
  const siteLng = (siteRes.data?.geo_lng as number | null) ?? null;
  const clientPhone10 = phoneRes.data?.phone10 != null ? String(phoneRes.data.phone10) : null;
  // Job work description (the "contract" the tech needs to see) — shown atop Line items.
  const workDescription = ((phoneRes.data?.job_description as string | null | undefined) ?? "").trim() || null;
  // Scheduled appointment time (job_360 carries only the date) — show it for everyone.
  const apptStart = (apptRes.data as { scheduled_start?: string } | null)?.scheduled_start ?? null;
  const apptWhen = apptStart
    ? new Date(apptStart).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;
  const callEnabled = process.env.CUSTOMER_VOICE_CALL_ENABLED === "true";

  // Worklist (task distribution) + materials-used. Resolve the crew's short names
  // (job_360 carries FULL names) for the lead's assignment dropdown.
  const [jobTasks, materialsUsed] = await Promise.all([
    getJobTasks(id),
    getMaterialsUsedForJob(id),
  ]);
  const crewFull = ((j.tech_all_names as string[] | null) ?? []).filter(Boolean);
  let crewShort: string[] = [];
  if (crewFull.length > 0) {
    const { data: crewRows } = await db()
      .from("tech_directory")
      .select("tech_short_name, hcp_full_name")
      .in("hcp_full_name", crewFull)
      .eq("is_active", true);
    crewShort = ((crewRows ?? []) as Array<{ tech_short_name: string | null }>)
      .map((r) => r.tech_short_name)
      .filter((x): x is string => !!x);
  }
  const canAssignTasks = !!(me?.isAdmin || me?.isManager || me?.tech?.is_lead);
  const myShortName = me?.tech?.tech_short_name ?? null;

  // HCP invoice line items for this job (the billed work). NOTE: this view is in
  // DOLLARS (it divides the raw cents), unlike hcp_*_raw — format directly.
  const { data: lineItemsData } = await db()
    .from("hcp_invoice_line_items_v")
    .select("line_item_id, line_item_name, line_item_type, quantity, unit_price, line_amount, invoice_number")
    .eq("hcp_job_id", id)
    .order("invoice_number", { ascending: true });
  const lineItems = (lineItemsData ?? []) as Array<{
    line_item_id: string;
    line_item_name: string | null;
    line_item_type: string | null;
    quantity: number | string | null;
    unit_price: number | string | null;
    line_amount: number | string | null;
    invoice_number: string | null;
  }>;
  const lineItemsTotal = lineItems.reduce((s, li) => s + (Number(li.line_amount) || 0), 0);
  const lineItemInvoices = Array.from(new Set(lineItems.map((li) => li.invoice_number).filter(Boolean)));
  const description = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {addressLine ? <span>{addressLine}</span> : null}
      {apptWhen ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800" title="Scheduled appointment time (HCP)">
          📅 {apptWhen}
        </span>
      ) : null}
      {directionsUrl ? (
        <a
          href={directionsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-teal-300 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800 transition hover:bg-teal-100"
          title="Open turn-by-turn directions to the job site"
        >
          🧭 Directions
        </a>
      ) : null}
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
        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/gallery?scope=job&id=${id}`} variant="secondary">
            📷 Photos
          </LinkButton>
          {canWrite ? <RefreshFromHcpButton hcpJobId={id} /> : null}
          {canWrite ? (
            <>
              <LinkButton href={`/estimate/new?job=${id}`} variant="primary">
                + Multi-option estimate (4-question)
              </LinkButton>
              <LinkButton href={`/job/${id}/estimate/new`} variant="secondary">
                + Estimate (freeform / voice note)
              </LinkButton>
              {customerId ? (
                <LinkButton href={`/membership/enroll?customer=${customerId}&job=${id}`} variant="secondary">
                  + Add membership
                </LinkButton>
              ) : null}
            </>
          ) : null}
        </div>
      }
    >
      <JobBriefingCard hcpJobId={id} briefing={briefing} pinnedEmails={pinnedForJob} />
      <div className="space-y-10">
        {/* Lifecycle trigger bar — ON TOP per Danny 2026-06-15. The 7-step bar
            (Schedule · On My Way · Start · Presentation · Perform Work · Collect · Finish). */}
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
            hcpWorkStatus={jobRaw?.status ?? null}
          />
          {firedTriggers.length > 0 && (
            <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50/50 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">Fired so far</div>
              <ScrollPanel tier="standard">
              <ul className="space-y-1 text-xs text-neutral-700">
                {firedTriggers.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">#{t.trigger_number}</span>
                    <span className="font-medium">{t.trigger_name}</span>
                    <span className="text-neutral-500">·</span>
                    {t.origin === "hcp_derived" ? (
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700" title="Derived from HCP work timestamps — not an in-app press">from HCP</span>
                    ) : (
                      <span>{t.fired_by ?? "—"}</span>
                    )}
                    <span className="text-neutral-400">·</span>
                    <span className="text-neutral-500">
                      {new Date(t.fired_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </li>
                ))}
              </ul>
              </ScrollPanel>
            </div>
          )}
        </Section>

        {/* Work order / HCP job note — for FM accounts (Vasa/Nfr FM etc.) the
            booking arrives via the vendor's portal and the scope is logged into
            the HCP note, NOT as a captured call/text. Surface it up top so the
            tech sees scope + PO# + contact on arrival without digging. */}
        {jobRaw?.hcp_notes || estRaw?.hcp_notes ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-base leading-none">📋</span>
              <h3 className="text-sm font-semibold text-amber-900">Private Notes</h3>
              <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-amber-600">from Housecall Pro</span>
            </div>
            {jobRaw?.hcp_notes ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-amber-950">{jobRaw.hcp_notes}</p>
            ) : null}
            {estRaw?.hcp_notes && estRaw.hcp_notes !== jobRaw?.hcp_notes ? (
              <p className="mt-2 whitespace-pre-wrap border-t border-amber-200 pt-2 text-sm leading-relaxed text-amber-900">
                <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600">from the estimate · </span>
                {estRaw.hcp_notes}
              </p>
            ) : null}
          </div>
        ) : null}
        {/* Job site — Street View + map pin + directions + (gated) call the client */}
        <JobSiteCard
          customerName={(j.customer_name as string) ?? null}
          street={(j.street as string) ?? null}
          city={(j.city as string) ?? null}
          lat={siteLat}
          lng={siteLng}
          directionsUrl={directionsUrl}
          customerPhone={clientPhone10}
          callEnabled={callEnabled}
          hcpJobId={id}
          hcpCustomerId={customerId}
        />

        {/* Worklist — lead lists + distributes tasks to the crew (Danny+Cody 2026-06-15) */}
        <Section
          title="Worklist"
          description={canAssignTasks
            ? "Lead view — add tasks and assign them to the crew. Everyone sees the list and checks tasks off."
            : "Tasks for this job. Your assigned tasks are highlighted; check them off as you go."}
        >
          <WorklistCard
            hcpJobId={id}
            tasks={jobTasks}
            canWrite={canWrite}
            canAssign={canAssignTasks}
            crew={crewShort}
            myShortName={myShortName}
          />
        </Section>

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

        {canEdit ? <AddJobLineItem hcpJobId={id} /> : null}

        <Section title="At a glance">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Date" value={(j.job_date as string) ?? "—"} />
            <StatCard label="Tech" value={<TechName name={j.tech_primary_name as string | null} formerSet={formerSet} />} />
            <StatCard label="Status" value={(j.appointment_status as string) ?? (j.status as string) ?? "—"} />
            <StatCard label="Crew size" value={(j.crew_size as number) ?? "—"} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Revenue" value={fmtMoney(j.revenue)} tone="brand" />
            {canEdit ? (
              <>
                <StatCard label="Materials" value={fmtMoney(j.materials_cost)} />
                <StatCard
                  label="Gross margin"
                  value={j.gross_margin_pct != null ? `${Number(j.gross_margin_pct).toFixed(0)}%` : "—"}
                  tone={Number(j.gross_margin_pct) >= 50 ? "green" : Number(j.gross_margin_pct) < 30 ? "amber" : "neutral"}
                />
                <StatCard label="Receipts cost" value={fmtMoney(j.receipts_cost)} />
              </>
            ) : null}
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

        {isProject ? (
          <Section
            title={`Multi-day project · ${projectSegments.length} segments`}
            description={`Invoice ${invoiceTrunk} is worked across ${projectSegments.length} day-segments (HCP carries them as -1, -2, … on the job number). Each segment is its own visit; together they're one project.`}
          >
            <ScrollPanel tier="standard">
              <ol className="space-y-2">
                {projectSegments.map((s) => {
                  const current = s.hcp_job_id === id;
                  return (
                    <li key={s.hcp_job_id}>
                      <Link
                        href={`/job/${s.hcp_job_id}`}
                        className={`flex flex-wrap items-center gap-2 rounded-2xl border p-3 ${current ? "border-brand-400 bg-brand-50" : "border-neutral-200 bg-white hover:border-neutral-300"}`}
                      >
                        <span className="font-mono text-sm font-semibold text-neutral-900">{s.invoice_number ?? "—"}</span>
                        {s.seg_no ? <Pill tone="slate" mono>day {s.seg_no}</Pill> : null}
                        <span className="text-xs text-neutral-500">
                          {s.scheduled_start ? new Date(s.scheduled_start).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" }) : "no date"}
                        </span>
                        {s.status ? <Pill tone="slate">{s.status}</Pill> : null}
                        {current
                          ? <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-brand-700">this segment</span>
                          : <span className="ml-auto text-xs text-brand-700">open →</span>}
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </ScrollPanel>
          </Section>
        ) : null}

        {invoiceTrunk ? (
          <Section
            title="Job media"
            description="Photos + videos from the Slack #job-media flow, served from Google Drive (thumbnails load on demand — no heavy storage). Click any tile to open it in Drive."
          >
            <JobMediaGallery invoiceTrunk={invoiceTrunk} />
          </Section>
        ) : null}

        {/* HCP invoice line items — the billed work (Danny 2026-06-15). View is in dollars. */}
        {lineItems.length > 0 ? (
          <Section
            title="Line items"
            description={
              lineItemInvoices.length > 1
                ? `${lineItems.length} items across ${lineItemInvoices.length} invoices`
                : `${lineItems.length} item${lineItems.length === 1 ? "" : "s"}${lineItemInvoices[0] ? ` · invoice ${lineItemInvoices[0]}` : ""}`
            }
          >
            {workDescription ? (
              <div className="mb-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Work description</div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-800">{workDescription}</p>
              </div>
            ) : null}
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Unit price</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {lineItems.map((li) => (
                    <tr key={li.line_item_id}>
                      <td className="px-3 py-2 text-neutral-900">
                        {li.line_item_name ?? "—"}
                        {li.line_item_type ? <span className="ml-1.5 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">{li.line_item_type}</span> : null}
                        {lineItemInvoices.length > 1 && li.invoice_number ? <span className="ml-1.5 text-[10px] text-neutral-400">#{li.invoice_number}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-700">{Number(li.quantity ?? 0)}</td>
                      <td className="px-3 py-2 text-right text-neutral-700">${Number(li.unit_price ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right font-medium text-neutral-900">${Number(li.line_amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-neutral-200 bg-neutral-50">
                  <tr>
                    <td className="px-3 py-2 font-medium text-neutral-700" colSpan={3}>Total</td>
                    <td className="px-3 py-2 text-right font-semibold text-neutral-900">${lineItemsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Section>
        ) : canEdit ? (
          <Section title="Line items" description="No line items on this job's invoice yet.">
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-500">
              No HCP line items for this job yet. Use the &ldquo;+ Add HCP line item&rdquo; button above to add one.
            </div>
          </Section>
        ) : null}

        <Section
          title="Job cost"
          description="Three factors: HCP line-item materials + logged receipts + GPS-derived labor. Receipts attach by invoice number."
        >
          {canEdit ? (
            <>
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
            </>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-neutral-800">
              Receipts · {fmtMoney(receiptsTotal)}{receiptItems.length ? ` (${receiptItems.length})` : ""}
            </h4>
          </div>
          {receiptItems.length > 0 ? (
            <ScrollPanel tier="standard">
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
            </ScrollPanel>
          ) : (
            <p className="mt-2 text-xs text-neutral-500">
              No receipts logged yet{j.invoice_number ? "" : " — this job has no invoice number to attach to"}.
            </p>
          )}
          {(canWrite || canEdit) && j.invoice_number ? (
            <div className="mt-3">
              <LogReceiptForm invoiceNumber={String(j.invoice_number)} jobId={id} />
            </div>
          ) : null}
          {canEdit ? <CostToDatePanel hcpJobId={id} /> : null}
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
            <ScrollPanel tier="standard">
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
            </ScrollPanel>
          )}
        </Section>

        {/* Lifecycle triggers — moved to the top of the page (Danny 2026-06-15) */}

        {/* Materials USED on the job — costing + restock; distinct from procurement needs below */}
        <Section
          title="Materials used"
          description="What got installed/used on this job — search the catalog or type a custom item. Feeds costing + restock."
        >
          <MaterialsUsedCard hcpJobId={id} materials={materialsUsed} canWrite={canWrite} />
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
            <ScrollPanel tier="standard">
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
            </ScrollPanel>
          ) : null}
          {canWrite ? (
            <LinkButton href={`/shopping?prefill_job=${id}`} variant="secondary">
              + Add need for this job
            </LinkButton>
          ) : null}
        </Section>

        <Section
          title="Internal notes"
          description="🔒 Visible to anyone assigned to this job (the crew) plus leadership — a tech not on the job can't see them. Never shown to the customer."
        >
          {canWrite ? (
            <div className="mb-3 rounded-2xl border border-neutral-200 bg-white p-4">
              <NoteForm
                action={addJobNote}
                hiddenFieldName="hcp_job_id"
                hiddenFieldValue={id}
                placeholder="Internal note for the crew on this job (not customer-facing)…"
                label="Add note"
              />
            </div>
          ) : (
            <div className="mb-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">
              Manager view — read-only. Notes can be added by Danny or a tech.
            </div>
          )}
          {notes.length > 0 ? (
            <ScrollPanel tier="standard">
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
            </ScrollPanel>
          ) : (
            <EmptyState title="No notes yet." description="Add one above to keep context for the next visit." />
          )}
        </Section>

        {recordings.length > 0 ? (
          <Section title="Recordings" description="Voice notes captured on this job via the Record button. Playback is private (signed, expires).">
            <ScrollPanel tier="standard">
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
            </ScrollPanel>
          </Section>
        ) : null}

        <Section
          title="Recent communications for this customer"
          description="Calls, texts, and emails surrounding this appointment window."
        >
          {comms && comms.length > 0 ? (
            <ScrollPanel tier="standard">
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
            </ScrollPanel>
          ) : (
            <EmptyState title="No communications." />
          )}
        </Section>

        <ProvenanceCard items={provenanceItems} />
      </div>
    </PageShell>
  );
}
