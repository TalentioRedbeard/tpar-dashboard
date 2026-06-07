"use client";

// Inventory Phase 3 — price book + vendor price comparison (/shopping).
// The price book (per vendor SKU, real receipt prices) is the solid layer and
// leads. The cross-vendor comparison sits below and is framed honestly: it
// depends on the candidate->item linker grouping the SAME part across vendors,
// which is still improving — so it shows each vendor's actual description and
// asks the reader to confirm the match, rather than presenting a buy signal.

import { useState, useMemo } from "react";
import type { PriceIntel } from "../app/shopping/price-intel-actions";
import { ScrollPanel } from "./ui/ScrollPanel";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const fmtDate = (s: string | null) =>
  s ? new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

export function PriceIntelPanel({ data }: { data: NonNullable<PriceIntel> }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  const book = useMemo(() => {
    if (!needle) return data.priceBook;
    return data.priceBook.filter((r) =>
      r.vendor_description.toLowerCase().includes(needle) ||
      (r.item_name ?? "").toLowerCase().includes(needle) ||
      (r.vendor_sku ?? "").toLowerCase().includes(needle) ||
      r.distributor_name.toLowerCase().includes(needle));
  }, [needle, data.priceBook]);

  return (
    <div className="space-y-6">
      {/* headline */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-2">
          <div className="text-lg font-semibold text-neutral-900">{data.pricedSkus}</div>
          <div className="text-xs text-neutral-500">priced vendor SKUs on file</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-2">
          <div className="text-lg font-semibold text-neutral-900">{data.comparedItems}</div>
          <div className="text-xs text-neutral-500">parts seen at 2+ vendors (to verify)</div>
        </div>
      </div>

      {/* PRICE BOOK — the solid layer: every vendor SKU + what we actually paid */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-neutral-700">Price book</h3>
            <p className="text-xs text-neutral-500">What you&rsquo;ve paid per part at each supplier, from real receipts.</p>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search part, SKU, vendor…"
            className="w-56 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </div>
        {book.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-4 text-center text-xs text-neutral-500">No matches.</div>
        ) : (
          <ScrollPanel tier="standard">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-neutral-50 text-left text-xs text-neutral-500">
                <tr>
                  <th className="px-2 py-1.5">Part</th>
                  <th className="px-2 py-1.5">Vendor</th>
                  <th className="px-2 py-1.5 text-right">Latest</th>
                  <th className="px-2 py-1.5 text-right">Range</th>
                  <th className="px-2 py-1.5 text-right">×</th>
                  <th className="px-2 py-1.5 text-right">Last</th>
                </tr>
              </thead>
              <tbody>
                {book.map((r) => (
                  <tr key={r.vendor_sku_id} className="border-t border-neutral-100">
                    <td className="px-2 py-1.5 text-neutral-800">{r.vendor_description}</td>
                    <td className="px-2 py-1.5 text-neutral-600">{r.distributor_name}</td>
                    <td className="px-2 py-1.5 text-right font-medium text-neutral-900">{money(r.latest_cents)}</td>
                    <td className="px-2 py-1.5 text-right text-neutral-500">{r.min_cents === r.max_cents ? "—" : `${money(r.min_cents)}–${money(r.max_cents)}`}</td>
                    <td className="px-2 py-1.5 text-right text-neutral-500">{r.obs}</td>
                    <td className="px-2 py-1.5 text-right text-neutral-500">{fmtDate(r.last_observed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollPanel>
        )}
      </div>

      {/* CROSS-VENDOR — honest framing: confirm the parts match before trusting a gap */}
      {data.comparisons.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-neutral-700">Possible cross-vendor matches</h3>
          <p className="mb-2 text-xs text-amber-700">
            ⚠ The matcher grouped these as the same part. <strong>Confirm the descriptions actually match</strong> before trusting a price gap —
            and check pack size + date. This improves as more SKUs get reviewed.
          </p>
          <ScrollPanel tier="primary">
            <ul className="space-y-2">
              {data.comparisons.map((c) => {
                const spread = c.max_cents - c.min_cents;
                return (
                  <li key={c.item_id} className="rounded-xl border border-neutral-200 bg-white p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-neutral-900">{c.item_name}</span>
                      <span className="text-xs text-neutral-500">spread {money(spread)}{c.savings_pct ? ` · ${c.savings_pct}%` : ""}</span>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {c.vendors.map((v, i) => {
                        const isLowest = v.unit_cents === c.min_cents;
                        return (
                          <div key={v.vendor + i} className={`rounded-lg border px-2.5 py-1.5 ${isLowest ? "border-emerald-200 bg-emerald-50/40" : "border-neutral-200"}`}>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm text-neutral-700">{v.vendor}</span>
                              <span className={`text-sm font-semibold ${isLowest ? "text-emerald-700" : "text-neutral-900"}`}>
                                {money(v.unit_cents)}{isLowest ? " ◂ lowest" : ""}
                              </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
                              <span className="text-neutral-600">{v.descr ?? "—"}</span>
                              <span>· seen {fmtDate(v.observed_on)}</span>
                              {v.obs > 1 ? <span>· {v.obs} obs (median)</span> : null}
                              {v.stale ? <span className="rounded bg-amber-100 px-1 py-0.5 font-medium text-amber-700">stale</span> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          </ScrollPanel>
        </div>
      ) : null}
    </div>
  );
}
