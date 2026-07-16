// HCP-native estimate detail — the in-app page the 3,040 HCP estimates never
// had (template build, plan 2026-07-13 section 3.2; layout B "Clipboard" per
// Danny's pick). Estimates attach to the CUSTOMER (house law); the job link,
// when one exists, is secondary. Money from raw options is CENTS → /100.

import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { Pill, type Tone } from "@/components/ui/Pill";
import { NoteForm } from "@/components/NoteForm";
import { addCustomerNote } from "@/lib/notes-actions";
import { db } from "@/lib/supabase";
import { FlagButton } from "@/components/FlagButton";
import { EntityFlags } from "@/components/EntityFlags";
import { EntityPageShell, EntityChecklist, RailCard, type ChecklistItem } from "@/components/EntityPageShell";
import { EstimateSiteCard } from "@/components/EstimateSiteCard";
import type { CurrentTech } from "@/lib/current-tech";
import { VoiceNoteRecorder } from "@/app/voice-notes/VoiceNoteRecorder";
import { listVoiceNotesForCustomer } from "@/app/voice-notes/actions";
import { SendEstimateButton } from "./SendEstimateButton";

type RawOption = {
  id?: string;
  name?: string | null;
  status?: string | null;
  approval_status?: string | null;
  total_amount?: number | string | null;
  message_from_pro?: string | null;
};

function money(cents: unknown): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return `$${Math.round(n / 100).toLocaleString("en-US")}`;
}
function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}
function fmtDay(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
}

function stageTone(stage: string | null): Tone {
  switch (stage) {
    case "won": case "approved": return "green";
    case "awaiting": case "sent": return "brand";
    case "canceled": case "lost": return "red";
    default: return "neutral";
  }
}

const TERMINAL_DEAD = new Set(["user canceled", "pro canceled"]);

export async function HcpEstimateView({ id, me }: { id: string; me: CurrentTech }) {
  const supa = db();
  const [rawRes, pipeRes, apptRes, apprRes] = await Promise.all([
    supa.from("hcp_estimates_raw").select("hcp_estimate_id, hcp_customer_id, raw, hcp_notes").eq("hcp_estimate_id", id).maybeSingle(),
    supa.from("estimate_pipeline_v").select("*").eq("hcp_estimate_id", id).maybeSingle(),
    supa
      .from("appointments_master")
      .select("hcp_job_id, scheduled_start, tech_all_names, geo_lat, geo_lng")
      .eq("hcp_estimate_id", id)
      .order("scheduled_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Online approval from the hosted /e page (estimate_approvals) — the
    // checklist and status rail must see it, not just HCP-side approvals.
    supa.from("estimate_approvals").select("option_name, total_dollars, created_at").eq("hcp_estimate_id", id).maybeSingle(),
  ]);

  const est = rawRes.data as { hcp_estimate_id: string; hcp_customer_id: string | null; raw: Record<string, unknown>; hcp_notes: string | null } | null;
  if (!est) {
    return (
      <PageShell title="Estimate not found" backHref="/estimates" backLabel="All estimates">
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          No HCP estimate with id <code className="font-mono text-xs">{id}</code>.
        </div>
      </PageShell>
    );
  }

  const raw = est.raw ?? {};
  const pipe = (pipeRes.data ?? {}) as Record<string, unknown>;
  const appt = apptRes.data as { hcp_job_id: string | null; scheduled_start: string | null; tech_all_names: string[] | null; geo_lat: number | null; geo_lng: number | null } | null;

  const customer = (raw["customer"] ?? {}) as Record<string, unknown>;
  const address = (raw["address"] ?? {}) as Record<string, unknown>;
  const options: RawOption[] = Array.isArray(raw["options"]) ? (raw["options"] as RawOption[]) : [];
  const schedule = (raw["schedule"] ?? {}) as Record<string, unknown>;
  const employees = Array.isArray(raw["assigned_employees"]) ? (raw["assigned_employees"] as Array<Record<string, unknown>>) : [];

  const customerName =
    [customer["first_name"], customer["last_name"]].map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean).join(" ")
    || (typeof customer["company_name"] === "string" ? (customer["company_name"] as string) : "")
    || (pipe.customer_name as string | null)
    || "Unknown customer";
  const custEmail = typeof customer["email"] === "string" ? (customer["email"] as string) : null;
  const custPhone = typeof customer["mobile_number"] === "string" && customer["mobile_number"]
    ? (customer["mobile_number"] as string)
    : typeof customer["home_number"] === "string" ? (customer["home_number"] as string) : null;
  const addressLine = [address["street"], address["city"], address["state"]].map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean).join(", ") || null;

  const estimateNumber = (raw["estimate_number"] as string | null) ?? (pipe.estimate_number as string | null) ?? null;
  const workStatus = (raw["work_status"] as string | null) ?? (pipe.work_status as string | null) ?? null;
  const stage = (pipe.stage as string | null) ?? null;
  const leadSource = (raw["lead_source"] as string | null) ?? null;
  const hcpUrl = (pipe.hcp_url as string | null) ?? null;
  const techNames = employees
    .map((e) => [e["first_name"], e["last_name"]].map((s) => (typeof s === "string" ? s : "")).filter(Boolean).join(" "))
    .filter(Boolean);

  const onlineApproval = apprRes.data as { option_name: string | null; total_dollars: number | null; created_at: string } | null;
  const dead = workStatus !== null && TERMINAL_DEAD.has(workStatus);
  const sent = !!pipe.last_sent_at;
  const viewed = !!(pipe.viewed_at || pipe.clicked_at);
  const approved = workStatus === "created job from estimate"
    || options.some((o) => o.approval_status === "approved" || o.approval_status === "pro approved")
    || onlineApproval !== null;
  const jobCreated = workStatus === "created job from estimate";

  // The lifecycle checklist (element 0, always on top). "dead" = canceled.
  const firstTodo = { found: false };
  const step = (done: boolean): ChecklistItem["state"] => {
    if (dead) return done ? "done" : "dead";
    if (done) return "done";
    if (!firstTodo.found) { firstTodo.found = true; return "now"; }
    return "todo";
  };
  const checklist: ChecklistItem[] = [
    { label: "Built", state: step(true) },
    { label: "Sent", state: step(sent) },
    { label: "Viewed", state: step(viewed) },
    { label: "Approved", state: step(approved) },
    { label: "Job created", state: step(jobCreated) },
    ...(dead ? [{ label: workStatus as string, state: "dead" as const }] : []),
  ];

  // Timeline: our tracked sends (HCP-side sends are invisible to us — honest).
  const { data: sendsData } = await supa
    .from("estimate_sends")
    .select("id, kind, followup_n, to_email, status, sent_at, delivered_at, opened_at, first_viewed_at, view_count, created_by")
    .eq("hcp_estimate_id", id)
    .order("sent_at", { ascending: false })
    .limit(12);
  const sends = (sendsData ?? []) as Array<Record<string, unknown>>;

  // Private notes = three sources merged (Danny 7/13): HCP's private notes
  // (mirrored into hcp_*_raw.hcp_notes by the webhook — no author attribution
  // in the mirror, so none is invented), our staff notes (customer_notes),
  // and voice recordings (tech_voice_notes; transcript auto-fills on-prem).
  // All customer-scoped: the same context follows the customer everywhere.
  const [notesRes, hcpJobNotesRes, hcpEstNotesRes, voiceNotes] = est.hcp_customer_id
    ? await Promise.all([
        supa
          .from("customer_notes")
          .select("id, author_email, body, created_at")
          .eq("hcp_customer_id", est.hcp_customer_id)
          .order("created_at", { ascending: false })
          .limit(8),
        supa
          .from("hcp_jobs_raw")
          .select("hcp_job_id, scheduled_start, hcp_notes")
          .eq("hcp_customer_id", est.hcp_customer_id)
          .not("hcp_notes", "is", null)
          .neq("hcp_notes", "")
          .order("scheduled_start", { ascending: false, nullsFirst: false })
          .limit(10),
        supa
          .from("hcp_estimates_raw")
          .select("hcp_estimate_id, last_synced_at, hcp_notes")
          .eq("hcp_customer_id", est.hcp_customer_id)
          .neq("hcp_estimate_id", id)
          .not("hcp_notes", "is", null)
          .neq("hcp_notes", "")
          .order("last_synced_at", { ascending: false, nullsFirst: false })
          .limit(10),
        listVoiceNotesForCustomer(est.hcp_customer_id),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, []];
  const notes = (notesRes.data ?? []) as Array<{ id: string; author_email: string; body: string; created_at: string }>;
  const hcpNotes: Array<{ key: string; label: string; href: string | null; body: string; ts: string | null }> = [
    ...(est.hcp_notes && est.hcp_notes.trim()
      ? [{ key: "self", label: "this estimate", href: null, body: est.hcp_notes.trim(), ts: null }]
      : []),
    ...((hcpJobNotesRes.data ?? []) as Array<{ hcp_job_id: string; scheduled_start: string | null; hcp_notes: string }>).map((n) => ({
      key: n.hcp_job_id, label: "job", href: `/job/${n.hcp_job_id}`, body: n.hcp_notes, ts: n.scheduled_start,
    })),
    ...((hcpEstNotesRes.data ?? []) as Array<{ hcp_estimate_id: string; last_synced_at: string | null; hcp_notes: string }>).map((n) => ({
      key: n.hcp_estimate_id, label: "estimate", href: `/estimate/${n.hcp_estimate_id}`, body: n.hcp_notes, ts: n.last_synced_at,
    })),
  ];
  const recordings = voiceNotes as Array<{
    id: string; ts: string; tech_short_name: string | null; user_email: string | null;
    transcript: string | null; transcription_status: string | null; audio_duration_seconds: number | null; intent_tag: string | null;
  }>;

  const totalDollars = pipe.total_dollars != null ? Number(pipe.total_dollars) : null;
  const minDollars = pipe.min_dollars != null ? Number(pipe.min_dollars) : null;

  return (
    <PageShell
      kicker="Estimate"
      title={customerName}
      description={
        <span className="font-mono text-xs text-neutral-500">
          {estimateNumber ? `#${estimateNumber} · ` : ""}{id}
        </span>
      }
      backHref="/estimates"
      backLabel="All estimates"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {me.canWrite || me.isManager ? <SendEstimateButton id={id} hasHcpEstimate /> : null}
          {est.hcp_customer_id ? (
            <Link
              href={`/customer/${est.hcp_customer_id}`}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              💬 Check Comms
            </Link>
          ) : null}
          {est.hcp_customer_id ? (
            <Link
              href={`/gallery?scope=customer&id=${est.hcp_customer_id}`}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              📷 Gallery
            </Link>
          ) : null}
          {/* Leadership convenience only (A4, 2026-07-16): techs stay in-app —
              view-as downgrades isAdmin/isManager, so impersonation previews
              the tech experience automatically. */}
          {hcpUrl && (me.isAdmin || me.isManager) ? (
            <a
              href={hcpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Open in HCP ↗
            </a>
          ) : null}
          <FlagButton
            entityType="estimate"
            entityId={id}
            entityLabel={`${customerName}${estimateNumber ? ` #${estimateNumber}` : ""}`}
          />
        </div>
      }
    >
      <EntityFlags entityType="estimate" entityId={id} />
      <EntityPageShell
        checklist={<EntityChecklist items={checklist} />}
        rail={
          <>
            <RailCard label="Customer">
              <div className="text-sm font-semibold text-neutral-900">
                {est.hcp_customer_id ? (
                  <Link href={`/customer/${est.hcp_customer_id}`} className="hover:underline">{customerName}</Link>
                ) : customerName}
              </div>
              {addressLine ? <div className="mt-0.5 text-xs text-neutral-600">{addressLine}</div> : null}
              <div className="mt-1.5 space-y-0.5 text-xs text-neutral-600">
                {custPhone ? <div>📞 {custPhone}</div> : null}
                {custEmail ? <div className="truncate">✉️ {custEmail}</div> : <div className="text-amber-700">✉️ no email on file</div>}
              </div>
              {leadSource ? <div className="mt-1.5 text-[11px] text-neutral-400">via {leadSource}</div> : null}
            </RailCard>
            <EstimateSiteCard
              addressLine={addressLine}
              lat={appt?.geo_lat ?? null}
              lng={appt?.geo_lng ?? null}
              customerName={customerName}
            />
            <RailCard label="Money">
              <div className="text-lg font-bold text-emerald-700">
                {totalDollars != null
                  ? minDollars != null && minDollars !== totalDollars
                    ? `$${Math.round(minDollars).toLocaleString()} – $${Math.round(totalDollars).toLocaleString()}`
                    : `$${Math.round(totalDollars).toLocaleString()}`
                  : "—"}
              </div>
              <div className="text-xs text-neutral-500">
                {options.length} option{options.length === 1 ? "" : "s"}
              </div>
            </RailCard>
            <RailCard label="Status">
              <div className="flex flex-wrap items-center gap-1.5">
                {stage ? <Pill tone={stageTone(stage)}>{stage}</Pill> : null}
                <span className="text-xs text-neutral-600">{workStatus ?? "—"}</span>
              </div>
              {onlineApproval ? (
                <div className="mt-1.5 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
                  ✓ Approved online{onlineApproval.option_name ? ` — ${onlineApproval.option_name}` : ""}
                  {onlineApproval.total_dollars != null ? ` ($${Math.round(Number(onlineApproval.total_dollars)).toLocaleString()})` : ""},{" "}
                  {fmtDay(onlineApproval.created_at)}
                </div>
              ) : null}
              <dl className="mt-2 space-y-0.5 text-xs text-neutral-600">
                <div className="flex justify-between gap-2"><dt className="text-neutral-400">Created</dt><dd>{fmtDay(raw["created_at"] as string | null)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-neutral-400">Age</dt><dd>{pipe.age_days != null ? `${pipe.age_days}d` : "—"}</dd></div>
                {schedule["scheduled_start"] ? (
                  <div className="flex justify-between gap-2"><dt className="text-neutral-400">Scheduled</dt><dd>{fmtDay(schedule["scheduled_start"] as string)}</dd></div>
                ) : null}
                {techNames.length ? (
                  <div className="flex justify-between gap-2"><dt className="text-neutral-400">Tech</dt><dd>{techNames.join(", ")}</dd></div>
                ) : null}
                {appt?.hcp_job_id ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-neutral-400">Job</dt>
                    <dd><Link href={`/job/${appt.hcp_job_id}`} className="font-mono text-[10px] text-brand-700 hover:underline">{appt.hcp_job_id.slice(0, 14)}…</Link></dd>
                  </div>
                ) : null}
              </dl>
            </RailCard>
          </>
        }
      >
        <Section title="Options & line items" description="Prices from HCP — the doc of record. Edits to line items happen there.">
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            {options.length === 0 ? (
              <div className="p-4 text-sm text-neutral-500">No options on this estimate.</div>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {options.map((o, i) => (
                  <li key={o.id ?? i} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-sm font-semibold text-neutral-900">{o.name || `Option ${i + 1}`}</span>
                        {o.approval_status || o.status ? (
                          <span className="ml-2 text-xs text-neutral-500">{o.approval_status ?? o.status}</span>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-sm font-bold text-emerald-700">{money(o.total_amount)}</span>
                    </div>
                    {o.message_from_pro ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-600">message from pro</summary>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-600">{o.message_from_pro}</p>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        <Section
          title="Private notes"
          description="🔒 Internal — HCP's private notes and ours, together. These live on the customer, so every estimate and job for them shows the same notes."
        >
          {me.canWrite && est.hcp_customer_id ? (
            <div className="mb-3 rounded-2xl border border-neutral-200 bg-white p-4">
              <NoteForm
                action={addCustomerNote}
                hiddenFieldName="hcp_customer_id"
                hiddenFieldValue={est.hcp_customer_id}
                placeholder="Internal note (gate codes, preferences, context — never customer-facing)…"
              />
            </div>
          ) : null}
          {notes.length === 0 && hcpNotes.length === 0 ? (
            <p className="text-sm text-neutral-500">No internal notes yet — here or in HCP.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-neutral-800">
                  <span className="whitespace-pre-wrap">{n.body}</span>
                  <span className="ml-2 text-xs text-neutral-500">— {n.author_email.split("@")[0]}, {fmtDay(n.created_at)}</span>
                </li>
              ))}
              {hcpNotes.map((n) => (
                <li key={n.key} className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
                  <span className="whitespace-pre-wrap">{n.body}</span>
                  <span className="ml-2 text-xs text-neutral-500">
                    — HCP note{" "}
                    {n.href ? (
                      <Link href={n.href} className="text-brand-700 hover:underline">({n.label}{n.ts ? `, ${fmtDay(n.ts)}` : ""})</Link>
                    ) : (
                      <>({n.label})</>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Tech notes & recordings"
          description="Tap, talk, walk away — recordings attach to this customer and transcribe automatically on our own hardware."
        >
          {me.canWrite && est.hcp_customer_id ? (
            <div className="mb-3">
              <VoiceNoteRecorder hcpCustomerId={est.hcp_customer_id} defaultIntentTag="estimate-context" />
            </div>
          ) : null}
          {recordings.length === 0 ? (
            <p className="text-sm text-neutral-500">No recordings for this customer yet.</p>
          ) : (
            <ul className="space-y-2">
              {recordings.map((r) => (
                <li key={r.id} className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-neutral-500">
                    <span>🎙️ {r.tech_short_name ?? r.user_email?.split("@")[0] ?? "?"}</span>
                    <span>{fmtDate(r.ts)}</span>
                    {r.audio_duration_seconds ? <span>{Math.round(r.audio_duration_seconds)}s</span> : null}
                    {r.intent_tag ? <span className="rounded bg-neutral-100 px-1.5">{r.intent_tag}</span> : null}
                    <Link href={`/voice-notes/${r.id}`} className="ml-auto text-brand-700 hover:underline">open / play ↗</Link>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-neutral-800">
                    {r.transcript?.trim()
                      ? r.transcript
                      : r.transcription_status === "pending_local"
                        ? <span className="italic text-neutral-400">transcribing…</span>
                        : <span className="italic text-neutral-400">no transcript</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Timeline" description="Our tracked sends and what the customer did with them. Emails HCP sent on its own don't appear here.">
          {sends.length === 0 ? (
            <p className="text-sm text-neutral-500">Never sent through our tracked lane.</p>
          ) : (
            <ul className="space-y-1.5">
              {sends.map((s) => (
                <li key={String(s.id)} className="flex flex-wrap items-baseline gap-x-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm">
                  <span className="font-medium text-neutral-900">
                    {s.kind === "followup" ? `Follow-up #${s.followup_n ?? "?"}` : "Sent"}
                  </span>
                  <span className="text-neutral-600">to {String(s.to_email ?? "?")}</span>
                  <span className="text-xs text-neutral-500">{fmtDate(s.sent_at as string | null)}</span>
                  <span className="ml-auto text-xs">
                    {s.first_viewed_at
                      ? <span className="font-medium text-emerald-700">viewed{Number(s.view_count) > 1 ? ` ×${s.view_count}` : ""}</span>
                      : s.opened_at
                        ? <span className="text-emerald-700">opened</span>
                        : s.status === "failed" || s.status === "bounced"
                          ? <span className="font-medium text-red-600">{String(s.status)}</span>
                          : <span className="text-neutral-500">{String(s.status ?? "")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {me.isAdmin ? (
          <p className="text-[11px] text-neutral-400">
            <span className="font-mono">{id}</span>
            {est.hcp_customer_id ? <> · customer <span className="font-mono">{est.hcp_customer_id}</span></> : null}
            {pipe.bid_estimate_id ? <> · bid <span className="font-mono">{String(pipe.bid_estimate_id)}</span></> : null}
          </p>
        ) : null}
      </EntityPageShell>
    </PageShell>
  );
}
