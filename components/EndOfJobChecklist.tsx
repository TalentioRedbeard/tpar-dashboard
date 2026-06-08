"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getJobChecklistPrefill, submitEndOfJobChecklist } from "@/app/me/checklist-actions";

type Tri = boolean | null;
type Office = "on_time" | "late" | "no" | "";

export function EndOfJobChecklist({ hcpJobId }: { hcpJobId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [memberHint, setMemberHint] = useState<string | null>(null);
  const [materialsAuto, setMaterialsAuto] = useState(false);
  const [heardAuto, setHeardAuto] = useState(false);

  const [approval, setApproval] = useState<Tri>(null);
  const [materials, setMaterials] = useState("");
  const [office, setOffice] = useState<Office>("");
  const [debriefed, setDebriefed] = useState<Tri>(null);
  const [membershipDiscussed, setMembershipDiscussed] = useState<Tri>(null);
  const [memberInterested, setMemberInterested] = useState<Tri>(null);
  const [maintenance, setMaintenance] = useState<Tri>(null);
  const [review, setReview] = useState<Tri>(null);
  const [heard, setHeard] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    let on = true;
    getJobChecklistPrefill(hcpJobId).then((p) => {
      if (!on) return;
      if (p.eoj.materialsDescription) { setMaterials((v) => v || p.eoj.materialsDescription); setMaterialsAuto(true); }
      if (p.eoj.howClientHeard) { setHeard((v) => v || p.eoj.howClientHeard); setHeardAuto(true); }
      if (p.eoj.isMember) {
        setMemberHint(p.eoj.membershipName ?? "Active member");
        setMembershipDiscussed((v) => (v === null ? true : v));
        setMemberInterested((v) => (v === null ? true : v));
      }
    }).catch(() => {});
    return () => { on = false; };
  }, [hcpJobId]);

  if (submitted) {
    return (
      <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        ✓ End-of-job checklist submitted.
      </div>
    );
  }

  const onSubmit = () => start(async () => {
    setErr(null);
    const res = await submitEndOfJobChecklist({
      hcp_job_id: hcpJobId,
      obtained_work_approval: approval,
      materials_description: materials || null,
      office_update: office || null,
      client_debriefed: debriefed,
      membership_discussed: membershipDiscussed,
      member_interested: memberInterested,
      maintenance_discussed: maintenance,
      review_requested: review,
      how_client_heard: heard || null,
      management_notes: notes || null,
    });
    if (!res.ok) { setErr(res.error); return; }
    setSubmitted(true);
    router.refresh();
  });

  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-blue-900">
        End-of-job checklist
        {/* Only claim "auto-filled" when something actually was — materials come
            from invoice line items, which don't exist until after invoicing, so
            on most just-finished jobs nothing prefills. Showing the badge anyway
            made the auto-fill look fake. */}
        {(materialsAuto || heardAuto || !!memberHint)
          ? <span className="rounded bg-blue-200/70 px-1 py-0.5 text-[9px] font-medium text-blue-800">auto-filled</span>
          : null}
      </div>
      <div className="space-y-2.5 text-xs text-neutral-700">
        <Row label="Work approval obtained?"><YesNo value={approval} onChange={setApproval} /></Row>

        <div>
          <div className="mb-1 text-neutral-600">
            Materials used
            {materialsAuto ? <span className="ml-1 text-[10px] font-medium text-emerald-700">⚡ from line items — edit as needed</span> : null}
          </div>
          <textarea
            value={materials}
            onChange={(e) => setMaterials(e.target.value)}
            rows={2}
            placeholder="Parts / materials used (every part — foundation of job cost)"
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        </div>

        <div>
          <div className="mb-1 text-neutral-600">Updated office on completion?</div>
          <div className="inline-flex overflow-hidden rounded-md border border-neutral-300">
            {([["on_time", "On time"], ["late", "Late"], ["no", "Didn't"]] as const).map(([v, l], i) => (
              <button
                key={v}
                type="button"
                onClick={() => setOffice(v)}
                className={`${i > 0 ? "border-l border-neutral-300 " : ""}px-2.5 py-1 text-xs font-medium ${
                  office === v ? (v === "no" ? "bg-red-600 text-white" : "bg-emerald-600 text-white") : "bg-white text-neutral-600"
                }`}
              >{l}</button>
            ))}
          </div>
        </div>

        <Row label="Client debriefed?"><YesNo value={debriefed} onChange={setDebriefed} /></Row>
        <Row label="Membership discussed?" hint={memberHint ? `⭐ ${memberHint}` : undefined}>
          <YesNo value={membershipDiscussed} onChange={setMembershipDiscussed} />
        </Row>
        <Row label="Member interested?"><YesNo value={memberInterested} onChange={setMemberInterested} /></Row>
        <Row label="Annual maintenance discussed?"><YesNo value={maintenance} onChange={setMaintenance} /></Row>
        <Row label="Requested Google review?"><YesNo value={review} onChange={setReview} /></Row>

        <div>
          <div className="mb-1 text-neutral-600">
            How did the client hear about us?
            {heardAuto ? <span className="ml-1 text-[10px] font-medium text-emerald-700">⚡ from lead source</span> : null}
          </div>
          <input
            value={heard}
            onChange={(e) => setHeard(e.target.value)}
            placeholder="e.g. Google, referral, repeat…"
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Notes for management (optional)"
          className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
        />
      </div>
      {err ? <div className="mt-1 text-xs text-red-700">{err}</div> : null}
      <button
        type="button"
        disabled={pending}
        onClick={onSubmit}
        className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Submit checklist"}
      </button>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>
        {label}
        {hint ? <span className="ml-1 text-[10px] font-medium text-emerald-700">{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}

function YesNo({ value, onChange }: { value: Tri; onChange: (v: boolean) => void }) {
  return (
    <span className="inline-flex overflow-hidden rounded-md border border-neutral-300">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`px-2.5 py-1 text-xs font-medium ${value === true ? "bg-emerald-600 text-white" : "bg-white text-neutral-600"}`}
      >Yes</button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`border-l border-neutral-300 px-2.5 py-1 text-xs font-medium ${value === false ? "bg-red-600 text-white" : "bg-white text-neutral-600"}`}
      >No</button>
    </span>
  );
}
