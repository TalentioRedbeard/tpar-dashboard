// /admin/marketing/lsa — Google Local Services Ads dashboard.
//
// Reads lsa_leads_raw, which is mirrored from ads.google.com/local-services-ads
// via the CSV-download path (manual export today; tpar-hcp-bot automates later).
//
// Source-of-truth signal: Danny's customer-name annotations encode lead lifecycle
// ("- Booked", "- Estimate, Declined", "Tire Kicker", "Spam", "Not a lead",
// "Abandoned"). We surface these as the dispute-candidacy lens.

import { redirect } from "next/navigation";
import { db } from "../../../../lib/supabase";
import { getSessionUser } from "../../../../lib/supabase-server";
import { isAdmin } from "../../../../lib/admin";
import { PageShell } from "../../../../components/PageShell";
import { Section } from "../../../../components/ui/Section";
import { StatCard } from "../../../../components/ui/StatCard";
import { UploadCsvForm } from "./UploadCsvForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "LSA · Marketing · Admin · TPAR-DB" };

type LeadRow = {
  lsa_lead_id: string;
  caller_name: string | null;
  caller_phone: string | null;
  service_category: string | null;
  status: string | null;          // "Charged" / "Not charged"
  lead_type: string | null;       // "Phone call" / "Message"
  location: string | null;
  last_activity: string | null;
  received_chi: string | null;    // YYYY-MM-DD
};

type CategoryRow = { category: string; n: number; charged: number };
type LocationRow = { location: string; n: number; charged: number };

async function rpc<T>(supa: ReturnType<typeof db>, sql: string): Promise<T[]> {
  const { data, error } = await supa.rpc("mcp_query_readonly", { query_text: sql });
  if (error) {
    console.error("LSA query error:", error.message);
    return [];
  }
  return (data ?? []) as T[];
}

// Heuristic: was this lead probably bad-quality? Detects Danny's annotation
// suffixes. "Charged" + bad-quality = dispute candidate.
const BAD_QUALITY_PATTERNS = [
  /\bspam\b/i,
  /\btire\s*kick/i,
  /\bnot\s*a\s*lead\b/i,
  /\babandoned/i,
  /\bvendor\b/i,
  /\bemployment\s*candidate/i,
  /\bcontractor\s*for/i,
  /\bcommercial\s*bid\b/i,
  /\bmissed\s*call\b/i,
  /\bvm\b/i,
  /\bvoicemail\b/i,
];

function isBadQuality(name: string | null): boolean {
  if (!name) return false;
  return BAD_QUALITY_PATTERNS.some((re) => re.test(name));
}

function lifecycleHint(name: string | null): string | null {
  if (!name) return null;
  if (/\bbooked\b/i.test(name)) {
    if (/\bcancelled?\b/i.test(name)) return "booked-cancelled";
    return "booked";
  }
  if (/\bestimate.*declined\b/i.test(name)) return "estimate-declined";
  if (/\bestimate\b/i.test(name)) return "estimate";
  if (/\bspam\b/i.test(name)) return "spam";
  if (/\btire\s*kick/i.test(name)) return "tire-kicker";
  if (/\bnot\s*a\s*lead\b/i.test(name)) return "not-a-lead";
  if (/\babandoned/i.test(name)) return "abandoned";
  if (/\bvendor\b/i.test(name)) return "vendor";
  if (/\bemployment\s*candidate/i.test(name)) return "employment-candidate";
  if (/\bcommercial\s*bid\b/i.test(name)) return "commercial-bid";
  if (/\bmissed\s*call\b|\bvm\b|\bvoicemail\b/i.test(name)) return "missed-call";
  return null;
}

const LIFECYCLE_TONE: Record<string, string> = {
  booked:               "bg-emerald-50 text-emerald-700 border border-emerald-200",
  "booked-cancelled":   "bg-amber-50 text-amber-800 border border-amber-200",
  "estimate":           "bg-sky-50 text-sky-700 border border-sky-200",
  "estimate-declined":  "bg-orange-50 text-orange-700 border border-orange-200",
  spam:                 "bg-red-100 text-red-800 border border-red-300",
  "tire-kicker":        "bg-red-50 text-red-700 border border-red-200",
  "not-a-lead":         "bg-red-100 text-red-800 border border-red-300",
  abandoned:            "bg-neutral-100 text-neutral-700 border border-neutral-200",
  vendor:               "bg-neutral-100 text-neutral-600 border border-neutral-200",
  "employment-candidate": "bg-neutral-100 text-neutral-600 border border-neutral-200",
  "commercial-bid":     "bg-violet-50 text-violet-700 border border-violet-200",
  "missed-call":        "bg-amber-50 text-amber-700 border border-amber-200",
};

export default async function LsaPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");

  const supa = db();

  const leadsP = rpc<LeadRow>(
    supa,
    `
    SELECT lsa_lead_id, caller_name, caller_phone, service_category, status,
           (raw_row_text::jsonb->>'lead_type') AS lead_type,
           (raw_row_text::jsonb->>'location') AS location,
           (raw_row_text::jsonb->>'last_activity') AS last_activity,
           to_char(received_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS received_chi
    FROM lsa_leads_raw
    WHERE received_at > now() - interval '180 days'
    ORDER BY received_at DESC NULLS LAST
    LIMIT 500
    `,
  );

  const byCategoryP = rpc<CategoryRow>(
    supa,
    `
    SELECT
      COALESCE(NULLIF(service_category,''),'(none)') AS category,
      count(*)::int AS n,
      count(*) FILTER (WHERE status = 'Charged')::int AS charged
    FROM lsa_leads_raw
    WHERE received_at > now() - interval '180 days'
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 20
    `,
  );

  const byLocationP = rpc<LocationRow>(
    supa,
    `
    SELECT
      COALESCE(NULLIF((raw_row_text::jsonb->>'location'),''),'(none)') AS location,
      count(*)::int AS n,
      count(*) FILTER (WHERE status = 'Charged')::int AS charged
    FROM lsa_leads_raw
    WHERE received_at > now() - interval '180 days'
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 20
    `,
  );

  const [leads, byCategory, byLocation] = await Promise.all([
    leadsP,
    byCategoryP,
    byLocationP,
  ]);

  const total = leads.length;
  const charged = leads.filter((l) => l.status === "Charged").length;
  const notCharged = leads.filter((l) => l.status === "Not charged").length;
  const chargedBadQuality = leads.filter(
    (l) => l.status === "Charged" && isBadQuality(l.caller_name),
  );
  const booked = leads.filter((l) => /\bbooked\b/i.test(l.caller_name ?? "")).length;
  const lastActivity = leads[0]?.received_chi ?? "—";

  return (
    <PageShell
      kicker="Marketing"
      title="Google Local Services Ads"
      description={
        <>
          Last 180 days from <code>lsa_leads_raw</code>. Mirrored from
          ads.google.com/local-services-ads via CSV download. Annotations on
          customer names ("- Booked", "Tire Kicker", "Spam") drive
          dispute-candidacy and lifecycle hints — keep tagging them.
        </>
      }
      backHref="/admin/marketing"
      backLabel="Marketing home"
    >
      <Section
        title="Refresh data"
        description={
          <>
            Export today's CSV from{" "}
            <a
              href="https://ads.google.com/local-services-ads"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-neutral-900"
            >
              ads.google.com/local-services-ads
            </a>{" "}
            (DOWNLOAD button) and drop it here. Re-uploads are idempotent — fingerprint hashes prevent duplicates.
          </>
        }
      >
        <UploadCsvForm />
      </Section>

      <div className="my-6" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Leads (180d)" value={total} />
        <StatCard
          label="Charged"
          value={charged}
          hint={total > 0 ? `${Math.round((100 * charged) / total)}% of total` : ""}
          tone="amber"
        />
        <StatCard
          label="Booked"
          value={booked}
          hint={charged > 0 ? `${Math.round((100 * booked) / charged)}% of charged` : ""}
          tone="green"
        />
        <StatCard
          label="Charged but bad-quality"
          value={chargedBadQuality.length}
          hint="Spam / tire kicker / abandoned / vendor — dispute candidates"
          tone={chargedBadQuality.length > 0 ? "red" : "neutral"}
          emphasis={chargedBadQuality.length > 0}
        />
      </div>

      {chargedBadQuality.length > 0 && (
        <>
          <div className="my-6" />
          <Section
            title="Dispute candidates"
            description={`Leads marked "Charged" by Google but tagged as low-quality in the customer name. Latest LSA policy uses Google's own AI for appeals — these are the cases worth running through it.`}
          >
            <div className="overflow-hidden rounded-xl border border-red-200 bg-red-50/30 shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-red-50 text-left text-[11px] uppercase tracking-wider text-red-800">
                  <tr>
                    <th className="px-4 py-2.5">Customer (annotated)</th>
                    <th className="px-4 py-2.5">Service</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Location</th>
                    <th className="px-4 py-2.5 text-right">Received</th>
                    <th className="px-4 py-2.5">Hint</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-100">
                  {chargedBadQuality.map((l) => {
                    const hint = lifecycleHint(l.caller_name);
                    return (
                      <tr key={l.lsa_lead_id} className="bg-white">
                        <td className="px-4 py-2 font-medium text-neutral-900">
                          {l.caller_name ?? "(no name)"}
                        </td>
                        <td className="px-4 py-2 text-neutral-700">
                          {l.service_category ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-neutral-600">{l.lead_type}</td>
                        <td className="px-4 py-2 text-neutral-600">{l.location}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                          {l.received_chi}
                        </td>
                        <td className="px-4 py-2">
                          {hint ? (
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${LIFECYCLE_TONE[hint] ?? "bg-neutral-100 text-neutral-700"}`}
                            >
                              {hint}
                            </span>
                          ) : (
                            <span className="text-xs text-neutral-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}

      <div className="my-6" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section
          title="By service category"
          description="Top categories ordered by lead volume."
        >
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5">Category</th>
                  <th className="px-4 py-2.5 text-right">Leads</th>
                  <th className="px-4 py-2.5 text-right">Charged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {byCategory.map((r) => (
                  <tr key={r.category}>
                    <td className="px-4 py-1.5 font-medium text-neutral-900">{r.category}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{r.n}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-neutral-600">
                      {r.charged}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="By location" description="LSA's geo-tagging.">
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5">Location</th>
                  <th className="px-4 py-2.5 text-right">Leads</th>
                  <th className="px-4 py-2.5 text-right">Charged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {byLocation.map((r) => (
                  <tr key={r.location}>
                    <td className="px-4 py-1.5 font-medium text-neutral-900">{r.location}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{r.n}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-neutral-600">
                      {r.charged}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <div className="my-6" />

      <Section
        title="All leads (last 180 days)"
        description={`${total} total · ${charged} charged · ${notCharged} not charged. Latest received: ${lastActivity}.`}
      >
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-2.5">Customer</th>
                <th className="px-4 py-2.5">Service</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Location</th>
                <th className="px-4 py-2.5">Charge</th>
                <th className="px-4 py-2.5 text-right">Received</th>
                <th className="px-4 py-2.5">Hint</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {leads.map((l) => {
                const hint = lifecycleHint(l.caller_name);
                const chargeBad = l.status === "Charged" && isBadQuality(l.caller_name);
                return (
                  <tr key={l.lsa_lead_id}>
                    <td className="px-4 py-2 font-medium text-neutral-900">
                      {l.caller_name ?? "(no name)"}
                    </td>
                    <td className="px-4 py-2 text-neutral-700">
                      {l.service_category ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">{l.lead_type ?? "—"}</td>
                    <td className="px-4 py-2 text-neutral-600">{l.location ?? "—"}</td>
                    <td
                      className={`px-4 py-2 ${
                        chargeBad
                          ? "font-medium text-red-700"
                          : l.status === "Charged"
                            ? "text-neutral-700"
                            : "text-neutral-400"
                      }`}
                    >
                      {l.status ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                      {l.received_chi}
                    </td>
                    <td className="px-4 py-2">
                      {hint ? (
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${LIFECYCLE_TONE[hint] ?? "bg-neutral-100 text-neutral-700"}`}
                        >
                          {hint}
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </PageShell>
  );
}
