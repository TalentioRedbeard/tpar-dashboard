// Vendor spend & receipts — the full receipt-capture surface (v1, 2026-07-07).
//
// Surfaces the compiling receipts_master corpus that had never been shown whole:
// every receipt captured (email supplier invoices + Slack photos + card imports +
// weekly payroll sheets), rolled up into (1) a top-strip of the money picture,
// (2) a vendor leaderboard (reconciled/folded names via vendor_spend_summary_v),
// (3) a 12-week company spend trend, and (4) a live recent-receipts feed.
//
// Money: receipts_master.amount is DOLLARS (numeric) — format as-is, no cents math.
// Gate: inherited from the /reports layout (admin + manager only).
//
// Sibling surfaces: /reports/receipts = the triage tool (attach unattributed
// receipts to jobs / mark overhead); this page is the read-only overview.

import Link from "next/link";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";

export const metadata = { title: "Vendor spend & receipts · TPAR-DB" };
export const dynamic = "force-dynamic";

const WEEKS = 12;

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const money2 = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: unknown) => Number(v ?? 0) || 0;

type StatRow = { amount: unknown; transaction_date: string | null; is_overhead: boolean | null; invoice_number: string | null; vendor_description: string | null };
type VendorRow = { vendor_name: string; is_known_distributor: boolean; receipt_count: unknown; total_spend: unknown; last_purchase: string | null };
type FeedRow = { id: number; transaction_date: string | null; vendor_description: string | null; amount: unknown; tech_name: string | null; is_overhead: boolean | null; source: string | null; photo_url: string | null };

// Monday-anchored week start for a YYYY-MM-DD date string (UTC-safe, no TZ drift).
function weekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export default async function VendorSpendReceiptsReport() {
  const supa = db();

  const [{ data: statData }, { data: vendorData }, { data: feedData }] = await Promise.all([
    supa
      .from("receipts_master")
      .select("amount, transaction_date, is_overhead, invoice_number, vendor_description")
      .limit(5000),
    supa
      .from("vendor_spend_summary_v")
      .select("vendor_name, is_known_distributor, receipt_count, total_spend, last_purchase")
      .order("total_spend", { ascending: false, nullsFirst: false })
      .limit(20),
    supa
      .from("receipts_master")
      .select("id, transaction_date, vendor_description, amount, tech_name, is_overhead, source, photo_url")
      .order("transaction_date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(30),
  ]);

  const rows = (statData ?? []) as StatRow[];
  const vendors = (vendorData ?? []) as VendorRow[];
  const feed = (feedData ?? []) as FeedRow[];

  // ---- Top strip ----
  const todayIso = new Date().toISOString().slice(0, 10);
  const cutoff30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  let total = 0, count = 0, overhead = 0, jobAttr = 0, attributed = 0, last30 = 0, last30n = 0;
  let latestDate: string | null = null;
  const vendorSet = new Set<string>();
  for (const r of rows) {
    const amt = num(r.amount);
    total += amt;
    count += 1;
    if (r.is_overhead === true) overhead += amt; else jobAttr += amt;
    if (r.invoice_number && r.invoice_number.trim() !== "") attributed += amt;
    const v = (r.vendor_description ?? "").trim();
    if (v) vendorSet.add(v.toLowerCase());
    const d = r.transaction_date;
    if (d) {
      if (!latestDate || d > latestDate) latestDate = d;
      if (d >= cutoff30 && d <= todayIso) { last30 += amt; last30n += 1; }
    }
  }
  const overheadPct = total > 0 ? Math.round((overhead / total) * 100) : 0;

  // ---- Weekly trend (last 12 weeks, company total per week) ----
  const weekMap = new Map<string, { spend: number; n: number }>();
  for (const r of rows) {
    if (!r.transaction_date) continue;
    const ws = weekStart(r.transaction_date);
    const cur = weekMap.get(ws) ?? { spend: 0, n: 0 };
    cur.spend += num(r.amount);
    cur.n += 1;
    weekMap.set(ws, cur);
  }
  const weeks: Array<{ week: string; spend: number; n: number }> = [];
  {
    const anchor = new Date(weekStart(todayIso) + "T00:00:00Z");
    for (let i = 0; i < WEEKS; i++) {
      const ws = anchor.toISOString().slice(0, 10);
      const cur = weekMap.get(ws) ?? { spend: 0, n: 0 };
      weeks.push({ week: ws, spend: cur.spend, n: cur.n });
      anchor.setUTCDate(anchor.getUTCDate() - 7);
    }
  }
  const maxWeek = Math.max(1, ...weeks.map((w) => w.spend));

  const stats: Array<{ label: string; value: string; sub?: string }> = [
    { label: "Total captured", value: money(total), sub: `${count.toLocaleString()} receipts` },
    { label: "Last 30 days", value: money(last30), sub: `${last30n} receipts` },
    { label: "Distinct vendors", value: vendorSet.size.toLocaleString() },
    { label: "Latest receipt", value: latestDate ?? "—" },
    { label: "Tagged overhead", value: `${overheadPct}%`, sub: `${money(overhead)} vs ${money(jobAttr)} job` },
  ];

  return (
    <PageShell
      title="Vendor spend & receipts"
      description={`Every receipt captured — supplier invoices, Slack photos, card imports, weekly sheets. ${money(total)} across ${count.toLocaleString()} receipts from ${vendorSet.size} vendors. Read-only overview; triage lives in Receipt reconciliation.`}
      backHref="/reports"
      backLabel="Reports"
      actions={
        <Link
          href="/reports/receipts"
          className="inline-flex items-center rounded-lg border border-brand-300 bg-white px-3 py-1.5 text-sm font-medium text-brand-800 transition hover:bg-brand-50"
        >
          Reconcile receipts →
        </Link>
      }
    >
      {/* Top strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{s.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-neutral-900">{s.value}</div>
            {s.sub ? <div className="mt-0.5 text-xs text-neutral-500">{s.sub}</div> : null}
          </div>
        ))}
      </div>

      {/* Vendor leaderboard */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Top vendors (all time)</h2>
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2 text-left">Vendor</th>
                <th className="px-3 py-2 text-right">Receipts</th>
                <th className="px-3 py-2 text-right">Total spend</th>
                <th className="px-3 py-2 text-right">Avg/receipt</th>
                <th className="px-3 py-2 text-right">Last purchase</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => {
                const spend = num(v.total_spend);
                const rc = num(v.receipt_count);
                return (
                  <tr key={v.vendor_name} className="border-t border-neutral-100">
                    <td className="px-3 py-2 font-medium text-neutral-900">
                      {v.vendor_name}
                      {v.is_known_distributor ? (
                        <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-brand-200">supplier</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{rc.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-900">{money2(spend)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{money2(spend / Math.max(1, rc))}</td>
                    <td className="px-3 py-2 text-right text-neutral-500">{v.last_purchase ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-neutral-400">Vendor names folded to their real supplier (Locke/Winnelson store-number variants merged) via vendor_spend_summary_v.</p>
      </section>

      {/* Weekly trend */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Weekly spend · last {WEEKS} weeks</h2>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <ul className="space-y-2">
            {weeks.map((w) => (
              <li key={w.week} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-xs tabular-nums text-neutral-500">{w.week.slice(5)}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-neutral-100">
                  <div className="h-4 rounded bg-brand-500" style={{ width: `${Math.max(1, Math.round((w.spend / maxWeek) * 100))}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-neutral-800">{money(w.spend)}</span>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-neutral-400">{w.n} rcpt</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Recent feed */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Recent receipts · last 30</h2>
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Vendor</th>
                <th className="px-3 py-2 text-left">Who</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Tag</th>
                <th className="px-3 py-2 text-right">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {feed.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100">
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-600">{r.transaction_date ?? "—"}</td>
                  <td className="px-3 py-2 font-medium text-neutral-900">{r.vendor_description ?? "(unknown)"}</td>
                  <td className="px-3 py-2 text-neutral-500">{r.tech_name ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-900">{money2(num(r.amount))}</td>
                  <td className="px-3 py-2">
                    {r.is_overhead ? (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">overhead</span>
                    ) : (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">job</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/reports/receipts/${r.id}/view`} className="text-xs text-brand-600 hover:underline">
                      view{r.photo_url ? " 📷" : ""}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-4 text-xs text-neutral-500">
        <strong>Note:</strong> &ldquo;overhead&rdquo; is the receipt&rsquo;s <code>is_overhead</code> tag (van stock / shop / fuel / marketing / not-yet-attributed). Reconciliation moves a receipt from overhead → a job so its cost lands in that job&rsquo;s margin. Weekly totals use transaction date; a few imported receipts have no date and are excluded from the trend + last-30 only.
      </p>
    </PageShell>
  );
}
