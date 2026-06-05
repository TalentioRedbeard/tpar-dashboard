import type { VendorSpend } from "./vendor-spend-actions";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

// "Where your money goes" — reconciled material spend per real supplier, with
// overhead separated. The Locke-vs-Winnelson split you actually care about.
export function VendorSpendPanel({ data }: { data: NonNullable<VendorSpend> }) {
  const { vendors, totalMaterial, totalOverhead, knownCount, vendorCount } = data;
  const maxMaterial = Math.max(1, ...vendors.map((v) => v.material_spend));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <div>
          <span className="text-2xl font-semibold text-neutral-900">{money(totalMaterial)}</span>
          <span className="ml-1.5 text-sm text-neutral-500">on materials</span>
        </div>
        <div>
          <span className="text-lg font-medium text-neutral-500">{money(totalOverhead)}</span>
          <span className="ml-1.5 text-sm text-neutral-400">overhead (fuel · fees · marketing)</span>
        </div>
        <div className="text-xs text-neutral-400">{knownCount} known suppliers · {vendorCount} vendors total</div>
      </div>

      <ul className="space-y-2.5">
        {vendors.map((v) => (
          <li key={v.vendor_name}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium text-neutral-800">{v.vendor_name}</span>
                {v.is_known_distributor ? (
                  <span className="shrink-0 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-brand-200">supplier</span>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <span className="font-mono text-sm font-medium text-neutral-900">{money(v.material_spend)}</span>
                {v.overhead_spend > 0 ? (
                  <span className="ml-2 text-[11px] text-neutral-400">+{money(v.overhead_spend)} oh</span>
                ) : null}
              </div>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-neutral-100">
              <div
                className={`h-1.5 rounded ${v.is_known_distributor ? "bg-brand-500" : "bg-neutral-300"}`}
                style={{ width: `${Math.max(2, Math.round((v.material_spend / maxMaterial) * 100))}%` }}
              />
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-400">{v.receipt_count} receipts</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
