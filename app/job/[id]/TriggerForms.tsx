"use client";

// Lifecycle-trigger forms for /job/[id]. Three buttons (#5 Present, #6 Finish,
// #7 Collect+Done) plus #2 (On My Way) for completeness. Each opens a small
// inline form; submit fires the trigger via the trigger registry.
//
// Per Danny 2026-05-04: "post-presentation and eoj forms should have push
// buttons for forms."

import { useState, useTransition } from "react";
import {
  fireOnMyWay, firePresent, fireFinishWork, fireCollectDone,
  fireSchedule, fireStart, firePerformWork,
  type CustomerDisposition, type PaymentMethod, type FiredTrigger,
} from "./trigger-actions";
import { markBriefingReviewed, type Briefing } from "./briefing-actions";
import { getOpenJobForTech, type OpenJob } from "@/lib/omw-guard-actions";
import { OmwGuardModal } from "@/components/OmwGuardModal";
import { OnSiteElapsedChip } from "@/components/OnSiteElapsedChip";
import { TriggerStageClock, buildStageWindows, fmtPressTime, type StageEvent, type StageWindow } from "@/components/TriggerStageClock";

const DISPOSITION_OPTIONS: Array<{ value: CustomerDisposition; label: string; emoji: string }> = [
  { value: "approved_now",       label: "Approved — pay now",      emoji: "✅" },
  { value: "approved_financing", label: "Approved — financing",    emoji: "💳" },
  { value: "partial",            label: "Approved — partial",      emoji: "🟡" },
  { value: "thinking",           label: "Thinking — follow up",    emoji: "🤔" },
  { value: "declined",           label: "Declined",                emoji: "❌" },
];

const PAYMENT_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "cash",      label: "Cash" },
  { value: "card",      label: "Card" },
  { value: "check",     label: "Check" },
  { value: "financing", label: "Financing" },
  { value: "other",     label: "Other" },
  { value: "not_yet",   label: "Not yet collected" },
];

// Map the webhook-fresh HCP work_status to which bar triggers are implied-done, so a
// job HCP already marks complete/scheduled doesn't show "Schedule" as next even with no
// app events. Bar trigger #s: 8 Schedule · 2 OMW · 3 Start · 5 Presentation · 9 Perform
// Work · 7 Collect · 6 Finish. (Danny 2026-06-15 — the buttons should reflect HCP.)
function impliedDoneFromHcp(status: string | null | undefined): Set<number> {
  const s = (status ?? "").toLowerCase();
  if (s.includes("complete")) return new Set([8, 2, 3, 5, 9, 7, 6]); // fully done
  if (s.includes("progress")) return new Set([8, 2, 3]);             // on site, working
  if (s.includes("scheduled")) return new Set([8]);                  // scheduled (not yet OMW)
  return new Set();                                                  // needs scheduling / canceled / unknown
}
function isCanceledStatus(status: string | null | undefined): boolean {
  return (status ?? "").toLowerCase().includes("cancel");
}

export function TriggerForms({
  hcpJobId,
  hcpCustomerId,
  appointmentId,
  firedTriggers,
  canWrite,
  briefing = null,
  hcpWorkStatus = null,
}: {
  hcpJobId: string;
  hcpCustomerId: string | null;
  appointmentId: string | null;
  firedTriggers: FiredTrigger[];
  canWrite: boolean;
  briefing?: Briefing | null;
  hcpWorkStatus?: string | null;
}) {
  const [openForm, setOpenForm] = useState<2 | 5 | 6 | 7 | null>(null);
  const [lightPending, setLightPending] = useState<number | null>(null);
  const [lightError, setLightError] = useState<string | null>(null);
  const [, startLight] = useTransition();
  // On-site elapsed chip: seed from the latest stored Start event (prefer a
  // real press over hcp_derived rows when both exist), set optimistically the
  // instant Start is tapped so the press visibly "took".
  const storedStartAt = (() => {
    const starts = firedTriggers.filter((t) => t.trigger_number === 3);
    if (starts.length === 0) return null;
    const pressed = starts.filter((t) => t.origin !== "hcp_derived");
    const pool = pressed.length > 0 ? pressed : starts;
    return pool.reduce((m, t) => (t.fired_at > m ? t.fired_at : m), pool[0].fired_at);
  })();
  const [startedAt, setStartedAt] = useState<string | null>(storedStartAt);
  // Per-button stage clocks: in-session light-trigger presses merged with the
  // stored rows so a tap shows its clock instantly; the form triggers skip
  // this because fireJobTrigger's revalidatePath refreshes props on its own.
  const [pressedAt, setPressedAt] = useState<Record<number, string>>({});

  // One-tap fire for the light, log-only buttons (Schedule #8, Start #3, Perform Work #9).
  const fireLight = (n: 3 | 8 | 9) => {
    setLightError(null);
    setLightPending(n);
    if (n === 3 && !startedAt) setStartedAt(new Date().toISOString());
    // Optimistic stage clock — only when this trigger has no canonical time yet
    // (a re-press dedups server-side and must not reset the clock).
    const already = stageWindows.has(n);
    if (!already) setPressedAt((p) => ({ ...p, [n]: new Date().toISOString() }));
    startLight(async () => {
      const fn = n === 8 ? fireSchedule : n === 3 ? fireStart : firePerformWork;
      const res = await fn({ hcp_job_id: hcpJobId, hcp_customer_id: hcpCustomerId });
      if (!res.ok) {
        setLightError(res.error);
        if (n === 3) setStartedAt(storedStartAt);
        if (!already) setPressedAt((p) => { const q = { ...p }; delete q[n]; return q; });
      }
      setLightPending(null);
    });
  };

  if (!canWrite) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">
        Read-only — lifecycle triggers can be fired by Danny or a tech.
      </div>
    );
  }

  // The bar, in Danny's lifecycle order. "light" = one-tap log; "form" = inline form.
  const firedSet = new Set<number>([
    ...firedTriggers.map((t) => t.trigger_number),
    ...Object.keys(pressedAt).map(Number),
  ]);
  const impliedDone = impliedDoneFromHcp(hcpWorkStatus);
  const canceled = isCanceledStatus(hcpWorkStatus);
  const isDone = (n: number) => firedSet.has(n) || impliedDone.has(n);
  const BAR: Array<{ n: number; label: string; emoji: string; kind: "light" | "form" }> = [
    { n: 8, label: "Schedule",     emoji: "🗓️", kind: "light" },
    { n: 2, label: "On My Way",    emoji: "🚐", kind: "form" },
    { n: 3, label: "Start",        emoji: "▶️", kind: "light" },
    { n: 5, label: "Presentation", emoji: "🎯", kind: "form" },
    { n: 9, label: "Perform Work", emoji: "🔧", kind: "light" },
    { n: 7, label: "Collect",      emoji: "💵", kind: "form" },
    { n: 6, label: "Finish",       emoji: "✅", kind: "form" },
  ];
  // Next-step hint = first bar button not done (by an app event OR by HCP status). None if canceled.
  const nextN = canceled ? null : BAR.find((b) => !isDone(b.n))?.n ?? null;
  // Stage windows: canonical time per trigger (press-preferred), each stage
  // ending at the next chronological fire; the latest stage stays open.
  const stageEvents: StageEvent[] = [
    ...firedTriggers,
    ...Object.entries(pressedAt).map(([n, at]) => ({
      trigger_number: Number(n), fired_at: at, origin: "dashboard", fired_by: null,
    })),
  ];
  const stageWindows = buildStageWindows(stageEvents, BAR.map((b) => b.n));
  const jobRunning = !isDone(6) && !isDone(7) && !canceled;

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        Fire a trigger as you move through the job — Schedule, Start, and Perform Work are one-tap; the rest open a quick form. Each records timestamp + your attribution.
      </p>
      {hcpWorkStatus ? (
        <p className={`text-[11px] ${canceled ? "text-red-700" : "text-neutral-400"}`}>
          HCP status: <span className="font-medium">{hcpWorkStatus}</span>
          {canceled ? " — job canceled in HCP" : impliedDone.size > 0 ? " — steps below reflect HCP progress" : ""}
        </p>
      ) : null}
      {/* Live on-site timer once Start fired; gone when work is finished/done. */}
      {startedAt && !isDone(6) && !isDone(7) && !canceled ? (
        <OnSiteElapsedChip startedAt={startedAt} />
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {BAR.map((b) => (
          <TriggerButton
            key={b.n}
            label={b.label} emoji={b.emoji}
            fired={firedSet.has(b.n)} impliedDone={impliedDone.has(b.n)} primary={nextN === b.n}
            pending={lightPending === b.n}
            stage={stageWindows.get(b.n) ?? null}
            jobRunning={jobRunning}
            onClick={() => {
              if (b.kind === "light") fireLight(b.n as 3 | 8 | 9);
              else setOpenForm(openForm === b.n ? null : (b.n as 2 | 5 | 6 | 7));
            }}
          />
        ))}
      </div>

      {lightError ? <p className="text-xs text-red-700">{lightError}</p> : null}

      {openForm === 2 && (
        <OnMyWayForm
          hcpJobId={hcpJobId} hcpCustomerId={hcpCustomerId} appointmentId={appointmentId}
          briefing={briefing}
          onClose={() => setOpenForm(null)}
        />
      )}
      {openForm === 5 && (
        <PresentForm
          hcpJobId={hcpJobId} hcpCustomerId={hcpCustomerId}
          onClose={() => setOpenForm(null)}
        />
      )}
      {openForm === 6 && (
        <FinishWorkForm
          hcpJobId={hcpJobId} hcpCustomerId={hcpCustomerId}
          onClose={() => setOpenForm(null)}
        />
      )}
      {openForm === 7 && (
        <CollectDoneForm
          hcpJobId={hcpJobId} hcpCustomerId={hcpCustomerId}
          onClose={() => setOpenForm(null)}
        />
      )}
    </div>
  );
}

function TriggerButton({
  label, emoji, fired, impliedDone, primary, pending, stage, jobRunning, onClick,
}: {
  label: string; emoji: string; fired: boolean; impliedDone?: boolean; primary: boolean;
  pending?: boolean; stage?: StageWindow | null; jobRunning?: boolean; onClick: () => void;
}) {
  const complete = fired || !!impliedDone;
  const cls = complete
    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
    : primary
    ? "border-brand-400 bg-brand-50 text-brand-900 ring-2 ring-brand-300"
    : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-300 hover:bg-neutral-50";
  // Stage clock shows when it has something honest to say: a closed stage
  // always, an open stage only while the job is running (live tick).
  const showClock = !!stage && (!!stage.endedAt || !!jobRunning);
  const title = stage
    ? `${label} — fired ${fmtPressTime(stage.at)}${stage.fired_by ? ` by ${stage.fired_by}` : ""}${stage.origin === "hcp_derived" ? " (HCP time)" : ""}`
    : label;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={label}
      title={title}
      className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-center transition disabled:opacity-60 ${cls}`}
    >
      <span className="text-2xl" aria-hidden>{emoji}</span>
      <span className="text-sm font-semibold leading-tight">{label}</span>
      <span className={`text-[10px] uppercase tracking-wide ${complete ? "text-emerald-700" : primary ? "text-brand-700" : "text-neutral-500"}${stage?.origin === "hcp_derived" ? " opacity-60" : ""}`}>
        {pending ? "logging…"
          : showClock && stage ? <TriggerStageClock firedAt={stage.at} endedAt={stage.endedAt} live={!!jobRunning} />
          : fired ? "fired" : impliedDone ? "done" : primary ? "next" : "not yet"}
      </span>
    </button>
  );
}

// ─── Form: #2 On My Way ────────────────────────────────────────────────
function OnMyWayForm({
  hcpJobId, hcpCustomerId, appointmentId, briefing, onClose,
}: {
  hcpJobId: string; hcpCustomerId: string | null; appointmentId: string | null; briefing: Briefing | null; onClose: () => void;
}) {
  const [customerCalled, setCustomerCalled] = useState(true);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();
  // OMW-without-Finish guard: a prior open job to resolve before OMW fires.
  const [guardJob, setGuardJob] = useState<OpenJob | null>(null);

  const doFireOmw = async () => {
    const res = await fireOnMyWay({
      hcp_job_id: hcpJobId, hcp_customer_id: hcpCustomerId, appointment_id: appointmentId,
      customer_called: customerCalled, notes: notes || undefined,
    });
    if (res.ok) setDone(true); else setError(res.error);
  };

  return (
    <Wrapper title="🚐 On My Way" onClose={onClose} done={done} doneText="On-my-way logged.">
      {!done && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              // Guard: if a prior job is still open (started, never Finished),
              // prompt Finish/Pause/Other before sending On-My-Way.
              const open = await getOpenJobForTech(hcpJobId);
              if (open) { setGuardJob(open); return; }
              await doFireOmw();
            });
          }}
        >
          {briefing ? <OmwBriefingPrompt hcpJobId={hcpJobId} briefing={briefing} /> : null}
          <Checkbox checked={customerCalled} onChange={setCustomerCalled} label="Called/texted the customer about ETA" />
          <NotesField value={notes} onChange={setNotes} placeholder="Anything about route, notes for self" />
          <SubmitRow isPending={isPending} error={error} label="Log On-My-Way" />
        </form>
      )}
      {guardJob ? (
        <OmwGuardModal
          openJob={guardJob}
          onProceed={() => { setGuardJob(null); startTransition(async () => { await doFireOmw(); }); }}
          onCancel={() => setGuardJob(null)}
        />
      ) : null}
    </Wrapper>
  );
}

// ─── Form: #5 Present ──────────────────────────────────────────────────
function PresentForm({
  hcpJobId, hcpCustomerId, onClose,
}: {
  hcpJobId: string; hcpCustomerId: string | null; onClose: () => void;
}) {
  const [optionsCount, setOptionsCount] = useState<string>("");
  const [optionsDescriptions, setOptionsDescriptions] = useState("");
  const [disposition, setDisposition] = useState<CustomerDisposition | null>(null);
  const [followupDate, setFollowupDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <Wrapper title="🎯 Presentation (post-presentation)" onClose={onClose} done={done} doneText="Presentation outcome logged.">
      {!done && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!disposition) { setError("Pick a customer disposition."); return; }
            startTransition(async () => {
              const res = await firePresent({
                hcp_job_id: hcpJobId, hcp_customer_id: hcpCustomerId,
                options_presented_count: optionsCount ? Number(optionsCount) : undefined,
                options_presented_descriptions: optionsDescriptions || undefined,
                customer_disposition: disposition,
                followup_date: disposition === "thinking" && followupDate ? followupDate : undefined,
                notes: notes || undefined,
              });
              if (res.ok) setDone(true); else setError(res.error);
            });
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr]">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1">Options shown</label>
              <input type="number" inputMode="numeric" min={0} value={optionsCount} onChange={(e) => setOptionsCount(e.target.value)} className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1">Brief option descriptions (optional)</label>
              <input type="text" value={optionsDescriptions} onChange={(e) => setOptionsDescriptions(e.target.value)} placeholder='e.g., "drain clear vs full repipe"' className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">Customer disposition *</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DISPOSITION_OPTIONS.map((o) => (
                <button
                  key={o.value} type="button"
                  onClick={() => setDisposition(o.value)}
                  className={
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition " +
                    (disposition === o.value
                      ? "border-brand-500 bg-brand-50 text-brand-900 shadow-sm"
                      : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300")
                  }
                >
                  <span>{o.emoji}</span><span>{o.label}</span>
                </button>
              ))}
            </div>
          </div>

          {disposition === "thinking" && (
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Follow-up date (optional)</label>
              <input type="date" value={followupDate} onChange={(e) => setFollowupDate(e.target.value)} className="block rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          )}

          <NotesField value={notes} onChange={setNotes} placeholder="What stuck out — objections, urgency, room temperature" />
          <SubmitRow isPending={isPending} error={error} label="Log Presentation" />
        </form>
      )}
    </Wrapper>
  );
}

// ─── Form: #6 Finish work ─────────────────────────────────────────────
function FinishWorkForm({
  hcpJobId, hcpCustomerId, onClose,
}: {
  hcpJobId: string; hcpCustomerId: string | null; onClose: () => void;
}) {
  const [photosDone, setPhotosDone] = useState(false);
  const [areaCleaned, setAreaCleaned] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <Wrapper title="✅ Finish work" onClose={onClose} done={done} doneText="Work-finished logged.">
      {!done && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await fireFinishWork({
                hcp_job_id: hcpJobId, hcp_customer_id: hcpCustomerId,
                final_photos_done: photosDone, area_cleaned: areaCleaned,
                notes: notes || undefined,
              });
              if (res.ok) setDone(true); else setError(res.error);
            });
          }}
        >
          <Checkbox checked={photosDone} onChange={setPhotosDone} label="Final photos taken" />
          <Checkbox checked={areaCleaned} onChange={setAreaCleaned} label="Work area cleaned up" />
          <NotesField value={notes} onChange={setNotes} placeholder="Anything notable about the work / customer" />
          <SubmitRow isPending={isPending} error={error} label="Log Finish Work" />
        </form>
      )}
    </Wrapper>
  );
}

// ─── Form: #7 Collect + Done ────────────────────────────────────────
function CollectDoneForm({
  hcpJobId, hcpCustomerId, onClose,
}: {
  hcpJobId: string; hcpCustomerId: string | null; onClose: () => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [amount, setAmount] = useState("");
  const [satisfied, setSatisfied] = useState(true);
  const [requestReview, setRequestReview] = useState(true);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <Wrapper title="💵 Collect" onClose={onClose} done={done} doneText="Collection logged.">
      {!done && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const amt = amount ? Number(amount.replace(/[^0-9.]/g, "")) : undefined;
              const res = await fireCollectDone({
                hcp_job_id: hcpJobId, hcp_customer_id: hcpCustomerId,
                payment_method: paymentMethod,
                amount_collected_dollars: amt && Number.isFinite(amt) ? amt : undefined,
                customer_satisfied: satisfied, request_review: requestReview,
                notes: notes || undefined,
              });
              if (res.ok) setDone(true); else setError(res.error);
            });
          }}
        >
          <a
            href={`https://pro.housecallpro.com/app/jobs/${hcpJobId}`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            💳 Open in HCP to take payment
          </a>
          <p className="text-[11px] leading-snug text-neutral-500">
            Payment is taken in <span className="font-medium">Housecall Pro</span> (card, cash, or check). This form does <span className="font-medium">not</span> charge a card — it just logs that payment was collected.
          </p>
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">Payment method</label>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_OPTIONS.map((o) => (
                <button
                  key={o.value} type="button"
                  onClick={() => setPaymentMethod(o.value)}
                  className={
                    "rounded-full px-3 py-1.5 text-sm font-medium transition " +
                    (paymentMethod === o.value
                      ? "bg-brand-600 text-white shadow-sm"
                      : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200")
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {paymentMethod !== "not_yet" && (
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Amount collected (optional)</label>
              <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g., 165.00" className="block w-32 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          )}

          <Checkbox checked={satisfied} onChange={setSatisfied} label="Customer appeared satisfied" />
          <Checkbox checked={requestReview} onChange={setRequestReview} label="Ask for a Google review" />
          <NotesField value={notes} onChange={setNotes} placeholder="Notes for follow-up letter / next visit" />
          <SubmitRow isPending={isPending} error={error} label="Log Collect" />
        </form>
      )}
    </Wrapper>
  );
}

// ─── Job-briefing prompt (soft gate before heading out / calling) ──────
function OmwBriefingPrompt({ hcpJobId, briefing }: { hcpJobId: string; briefing: Briefing }) {
  const [reviewed, setReviewed] = useState(briefing.reviewedByMe);
  const [expanded, setExpanded] = useState(!briefing.reviewedByMe);
  const [pending, startTransition] = useTransition();
  return (
    <div className={`rounded-xl border-2 p-3 ${reviewed ? "border-emerald-300 bg-emerald-50" : "border-amber-400 bg-amber-50"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-neutral-900">
          📋 {reviewed ? "Job briefing reviewed ✓" : "Review the job briefing before you head out / call"}
        </span>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="shrink-0 text-xs text-neutral-500 hover:text-neutral-800">
          {expanded ? "hide" : "show"}
        </button>
      </div>
      {expanded ? (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-neutral-700">{briefing.transcript}</p>
      ) : null}
      {!reviewed ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => { const r = await markBriefingReviewed(hcpJobId, briefing.voiceNoteId); if (r.ok) setReviewed(true); })}
          className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "I've reviewed it ✓"}
        </button>
      ) : null}
    </div>
  );
}

// ─── Shared form atoms ─────────────────────────────────────────────
function Wrapper({ title, onClose, done, doneText, children }: { title: string; onClose: () => void; done: boolean; doneText: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-neutral-900">{title}</h3>
        <button type="button" onClick={onClose} className="text-xs text-neutral-500 hover:text-neutral-700">close ×</button>
      </div>
      {done ? (
        <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
          ✓ {doneText}
        </div>
      ) : children}
    </div>
  );
}
function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500" />
      {label}
    </label>
  );
}
function NotesField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Notes (optional)</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} placeholder={placeholder} className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
    </div>
  );
}
function SubmitRow({ isPending, error, label }: { isPending: boolean; error: string | null; label: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <button type="submit" disabled={isPending} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50">
        {isPending ? "Logging…" : label}
      </button>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </div>
  );
}
