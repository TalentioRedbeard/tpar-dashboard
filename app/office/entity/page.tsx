// /office/entity — the entity answer sheet + licenses + coverage + the
// Kelsey→Danny handoff checklist. The page that ends CP-575-class fire
// drills: every fact a carrier/bank/platform asks for, one screen.

import { getEntityOverview } from "@/lib/office/actions";
import { ContactVerbs } from "./ContactVerbs";

export const dynamic = "force-dynamic";

type Entity = {
  legal_name: string; dba: string | null; ein: string | null; entity_type: string | null;
  tax_classification: string | null; formation_date: string | null;
  ok_sos_filing_number: string | null; registered_agent: string | null;
  principal_address: string | null; notes: string | null;
};
type Credential = {
  id: string; kind: string; jurisdiction: string; credential_number: string | null;
  issued_on: string | null; expires_on: string | null; status: string; notes: string | null;
};
type Policy = {
  id: string; line: string; carrier: string | null; agency: string | null;
  agency_contact: string | null; policy_number: string | null; expires_on: string | null;
  status: string; notes: string | null;
};
type Contact = {
  id: string; system: string; purpose: string | null; named_contact: string | null;
  login_holder: string | null; transition_status: string; notes: string | null;
};

const LINE_LABEL: Record<string, string> = {
  gl: "General liability", wc: "Workers comp", bop: "Business owner's policy",
  commercial_auto: "Commercial auto", umbrella: "Umbrella", bond: "Bond", other: "Other",
};
const POLICY_TONE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-800",
  lapsed: "bg-red-100 text-red-800",
  replaced: "bg-neutral-100 text-neutral-700",
  unknown: "bg-amber-100 text-amber-800",
};
const CRED_TONE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  expired: "bg-red-100 text-red-800",
  pending: "bg-amber-100 text-amber-800",
  surrendered: "bg-neutral-100 text-neutral-700",
  unknown: "bg-amber-100 text-amber-800",
};

export default async function EntityPage() {
  const res = await getEntityOverview();
  if (!res.ok) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">{res.error}</div>;
  }
  const o = res.overview as {
    entity: Entity | null; credentials: Credential[]; policies: Policy[]; contacts: Contact[];
  };

  return (
    <div className="space-y-6">
      {o.entity ? (
        <section className="rounded-2xl border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-navy-900">The entity</h2>
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-neutral-500">Legal name</dt><dd className="font-medium text-navy-900">{o.entity.legal_name}</dd></div>
            <div><dt className="text-neutral-500">EIN</dt><dd className="font-medium text-navy-900">{o.entity.ein ?? "—"}</dd></div>
            <div><dt className="text-neutral-500">Entity type</dt><dd className="font-medium text-navy-900">{o.entity.entity_type ?? "—"}</dd></div>
            <div><dt className="text-neutral-500">Tax classification</dt><dd className="font-medium text-navy-900">{o.entity.tax_classification ?? "—"}</dd></div>
            <div><dt className="text-neutral-500">SoS filing #</dt><dd className="font-medium text-navy-900">{o.entity.ok_sos_filing_number ?? "— (lookup pending)"}</dd></div>
            <div><dt className="text-neutral-500">Formed</dt><dd className="font-medium text-navy-900">{o.entity.formation_date ?? "— (lookup pending)"}</dd></div>
          </dl>
          {o.entity.notes ? <p className="mt-3 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-600">{o.entity.notes}</p> : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-navy-900">Licenses & registrations</h2>
        <ul className="divide-y divide-neutral-100 text-sm">
          {o.credentials.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="font-medium text-navy-900">{c.jurisdiction}</div>
                <div className="text-xs text-neutral-500">
                  {c.credential_number ?? "number not captured"}
                  {c.issued_on ? ` · issued ${c.issued_on}` : ""}
                  {c.expires_on ? ` · expires ${c.expires_on}` : " · expiry unknown"}
                </div>
                {c.notes ? <div className="mt-1 text-xs text-neutral-500">{c.notes}</div> : null}
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CRED_TONE[c.status] ?? CRED_TONE.unknown}`}>{c.status}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-navy-900">Coverage</h2>
        <p className="mb-3 text-xs text-neutral-500">The question this section exists to answer: are we covered, with whom, via which agent?</p>
        <ul className="divide-y divide-neutral-100 text-sm">
          {o.policies.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="font-medium text-navy-900">{LINE_LABEL[p.line] ?? p.line}</div>
                <div className="text-xs text-neutral-500">
                  {p.carrier ?? "carrier unknown"}
                  {p.agency ? ` · via ${p.agency}` : ""}
                  {p.policy_number ? ` · #${p.policy_number}` : ""}
                  {p.expires_on ? ` · expires ${p.expires_on}` : ""}
                </div>
                {p.notes ? <div className="mt-1 text-xs text-neutral-500">{p.notes}</div> : null}
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${POLICY_TONE[p.status] ?? POLICY_TONE.unknown}`}>{p.status}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-navy-900">The handoff</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Contact-of-record and login transitions, Kelsey → Danny. Metadata only — credentials never live here.
        </p>
        <ContactVerbs contacts={o.contacts} />
      </section>
    </div>
  );
}
