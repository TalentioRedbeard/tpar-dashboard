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
  type CustomerDisposition, type PaymentMethod, type FiredTrigger,
} from "./trigger-actions";

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

function hasFired(triggers: FiredTrigger[], n: number): boolean {
  return triggers.some((t) => t.trigger_number === n);
}

export function TriggerForms({
  hcpJobId,
  hcpCustomerId,
  appointmentId,
  firedTriggers,
  canWrite,
}: {
  hcpJobId: string;
  hcpCustomerId: string | null;
  appointmentId: string | null;
  firedTriggers: FiredTrigger[];
  canWrite: boolean;
}) {
  const [openForm, setOpenForm] = useState<2 | 5 | 6 | 7 | null>(null);

  if (!canWrite) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">
        Read-only — lifecycle triggers can be fired by Danny or a tech.
      </div>
    );
  }

  // Determine which trigger should be the primary CTA based on what's fired
  const fired2 = hasFired(firedTriggers, 2);
  const fired5 = hasFired(firedTriggers, 5);
  const fired6 = hasFired(firedTriggers, 6);
  const fired7 = hasFired(firedTriggers, 7);

  const primary: 2 | 5 | 6 | 7 =
    !fired2 ? 2 :
    !fired5 ? 5 :
    !fired6 ? 6 :
    !fired7 ? 7 :
    7; // all fired; last is still the most-recent action

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        Fire a lifecycle trigger as you progress through the job. The system records timestamp + form data + your attribution.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <TriggerButton
          n={2} label="On My Way" emoji="🚐"
          fired={fired2} primary={primary === 2}
          onClick={() => setOpenForm(openForm === 2 ? null : 2)}
        />
        <TriggerButton
          n={5} label="Present" emoji="🎯"
          fired={fired5} primary={primary === 5}
          onClick={() => setOpenForm(openForm === 5 ? null : 5)}
        />
        <TriggerButton
          n={6} label="Finish work" emoji="✅"
          fired={fired6} primary={primary === 6}
          onClick={() => setOpenForm(openForm === 6 ? null : 6)}
        />
        <TriggerButton
          n={7} label="Collect + Done" emoji="💵"
          fired={fired7} primary={primary === 7}
          onClick={() => setOpenForm(openForm === 7 ? null : 7)}
        />
      </div>

      {openForm === 2 && (
        <OnMyWayForm
          hcpJobId={hcpJobId} hcpCustomerId={hcpCustomerId} appointmentId={appointmentId}
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
  n, label, emoji, fired, primary, onClick,
}: {
  n: number; label: string; emoji: string; fired: boolean; primary: boolean; onClick: () => void;
}) {
  const cls = fired
    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
    : primary
    ? "border-brand-400 bg-brand-50 text-brand-900 ring-2 ring-brand-300"
    : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-300 hover:bg-neutral-50";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-center transition ${cls}`}
    >
      <span className="text-2xl" aria-hidden>{emoji}</span>
      <span className="text-sm font-semibold">#{n} · {label}</span>
      <span className={`text-[10px] uppercase tracking-wide ${fired ? "text-emerald-700" : primary ? "text-brand-700" : "text-neutral-500"}`}>
        {fired ? "fired" : primary ? "next" : "not yet"}
      </span>
    </button>
  );
}

// ─── Form: #2 On My Way ────────────────────────────────────────────────
function OnMyWayForm({
  hcpJobId, hcpCustomerId, appointmentId, onClose,
}: {
  hcpJobId: string; hcpCustomerId: string | null; appointmentId: string | null; onClose: () => void;
}) {
  const [customerCalled, setCustomerCalled] = useState(true);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <Wrapper title="🚐 On My Way" onClose={onClose} done={done} doneText="On-my-way logged.">
      {!done && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await fireOnMyWay({
                hcp_job_id: hcpJobId, hcp_customer_id: hcpCustomerId, appointment_id: appointmentId,
                customer_called: customerCalled, notes: notes || undefined,
              });
              if (res.ok) setDone(true); else setError(res.error);
            });
          }}
        >
          <Checkbox checked={customerCalled} onChange={setCustomerCalled} label="Called/texted the customer about ETA" />
          <NotesField value={notes} onChange={setNotes} placeholder="Anything about route, notes for self" />
          <SubmitRow isPending={isPending} error={error} label="Log On-My-Way" />
        </form>
      )}
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
    <Wrapper title="🎯 Present (post-presentation)" onClose={onClose} done={done} doneText="Presentation outcome logged.">
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
    <Wrapper title="💵 Collect + Done" onClose={onClose} done={done} doneText="Collect-and-done logged.">
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
          <SubmitRow isPending={isPending} error={error} label="Log Collect + Done" />
        </form>
      )}
    </Wrapper>
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
