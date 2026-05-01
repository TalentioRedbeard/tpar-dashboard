// /price — pricing lookup. Mirrors the Slack /price command for the dashboard.
//
// Sources: pricing_quick_reference (Danny's quick-lookup tier ranges) and
// price_book (HCP catalog with sell prices). Both tables get an ILIKE scan
// on item_name; surfaces estimating_knowledge for matching service-type +
// technical-category combinations so the user sees the live scope rules
// alongside the price.
//
// v0 — text search only. v1 could add Claude Haiku classification +
// vector similarity (the Slack version has both); for the dashboard
// surface ILIKE is enough to be useful.

import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { Section } from "../../components/ui/Section";
import { Pill } from "../../components/ui/Pill";
import { EmptyState } from "../../components/ui/EmptyState";

export const metadata = { title: "Price · TPAR-DB" };
export const dynamic = "force-dynamic";

type QRRow = {
  id: number;
  item_name: string;
  price_low: number | null;
  price_high: number | null;
  price_note: string | null;
  category: string | null;
  pending_review: boolean | null;
};

type PBRow = {
  id: number;
  item_name: string;
  sell_price: number | null;
  unit: string | null;
  unit_cost: number | null;
  category: string | null;
  technical_category: string | null;
  service_type: string | null;
  work_type: string | null;
  task_code: string | null;
  pricing_method: string | null;
  pending_review: boolean | null;
  notes: string | null;
};

type KnowledgeRow = {
  id: number;
  knowledge_type: string;
  content: string;
  scope_level: string;
  scope_service_type: string | null;
  scope_technical_category: string | null;
  sort_order: number | null;
};

function fmtPrice(low: number | null, high: number | null, note: string | null): string {
  if (low == null && high == null) return "—";
  if (low != null && high != null && low !== high) {
    return `$${Math.round(low).toLocaleString()}–$${Math.round(high).toLocaleString()}${note ? ` · ${note}` : ""}`;
  }
  return `$${Math.round(low ?? high ?? 0).toLocaleString()}${note ? ` · ${note}` : ""}`;
}

function fmtSell(p: number | null): string {
  if (p == null) return "—";
  return `$${p.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default async function PricePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const supa = db();

  let qrRows: QRRow[] = [];
  let pbRows: PBRow[] = [];
  let knowledge: KnowledgeRow[] = [];

  if (q) {
    const [qrRes, pbRes] = await Promise.all([
      supa
        .from("pricing_quick_reference")
        .select("id, item_name, price_low, price_high, price_note, category, pending_review")
        .eq("active", true)
        .ilike("item_name", `%${q}%`)
        .order("item_name")
        .limit(15),
      supa
        .from("price_book")
        .select("id, item_name, sell_price, unit, unit_cost, category, technical_category, service_type, work_type, task_code, pricing_method, pending_review, notes")
        .eq("active", true)
        .ilike("item_name", `%${q}%`)
        .order("item_name")
        .limit(20),
    ]);
    qrRows = (qrRes.data ?? []) as QRRow[];
    pbRows = (pbRes.data ?? []) as PBRow[];

    // For knowledge: pull entries scoped to the technical categories of any
    // price_book matches (most useful surface — shows the live rules
    // alongside the price tier).
    const techCats = Array.from(new Set(pbRows.map((r) => r.technical_category).filter((c): c is string => Boolean(c))));
    if (techCats.length > 0) {
      const { data: kData } = await supa
        .from("estimating_knowledge")
        .select("id, knowledge_type, content, scope_level, scope_service_type, scope_technical_category, sort_order")
        .eq("active", true)
        .in("scope_technical_category", techCats)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .limit(30);
      knowledge = (kData ?? []) as KnowledgeRow[];
    }
  }

  const totalMatches = qrRows.length + pbRows.length;

  return (
    <PageShell
      kicker="Tool 1"
      title="Price"
      description="Quick pricing lookup across pricing_quick_reference (Danny's tier ranges) and price_book (HCP catalog). Mirrors the Slack /price command."
    >
      <form className="mb-6 flex flex-wrap gap-2" role="search">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="e.g. water heater, drain clean, faucet install, P-trap"
          className="flex-1 min-w-64 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          autoFocus
        />
        <button
          type="submit"
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800"
        >
          Look up
        </button>
      </form>

      {!q && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 text-sm text-neutral-700">
          <p className="mb-2 font-medium text-neutral-900">Try one of these:</p>
          <ul className="space-y-1.5 text-neutral-600">
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">water heater</code> — fixture install pricing</li>
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">drain clean</code> — service tier ranges</li>
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">faucet</code> — quick reference + price book</li>
            <li><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">P-trap</code> — DWV item lookup</li>
          </ul>
        </div>
      )}

      {q && totalMatches === 0 && (
        <EmptyState
          title="No matches."
          description={<>No items in pricing_quick_reference or price_book match <strong>&ldquo;{q}&rdquo;</strong>. Try a broader keyword or check spelling.</>}
        />
      )}

      {qrRows.length > 0 && (
        <Section title={`Quick reference (${qrRows.length})`} description="Danny's tier ranges. Use these for service work.">
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Item</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Category</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">Price</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {qrRows.map((r) => (
                  <tr key={r.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-2 font-medium text-neutral-900">
                      {r.item_name}
                      {r.pending_review ? <Pill tone="amber" className="ml-2">pending review</Pill> : null}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">{r.category ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-700">
                      {fmtPrice(r.price_low, r.price_high, null)}
                    </td>
                    <td className="px-4 py-2 text-xs text-neutral-600">{r.price_note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {pbRows.length > 0 && (
        <Section
          title={`Price book (${pbRows.length})`}
          description="HCP catalog entries with sell prices, scoped by service type / technical category."
          className="mt-8"
        >
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Item</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Service · Tech</th>
                  <th className="px-4 py-2 text-right font-medium text-neutral-600">Sell</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Method</th>
                  <th className="px-4 py-2 text-left font-medium text-neutral-600">Task</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {pbRows.map((r) => (
                  <tr key={r.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-2">
                      <div className="font-medium text-neutral-900">
                        {r.item_name}
                        {r.pending_review ? <Pill tone="amber" className="ml-2">pending review</Pill> : null}
                      </div>
                      {r.notes ? <div className="text-xs text-neutral-500">{r.notes.slice(0, 200)}</div> : null}
                    </td>
                    <td className="px-4 py-2 text-xs text-neutral-600">
                      {r.service_type ?? "—"}
                      {r.technical_category ? <span className="text-neutral-400"> · {r.technical_category}</span> : null}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{fmtSell(r.sell_price)}</td>
                    <td className="px-4 py-2 text-xs text-neutral-600">{r.pricing_method ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-neutral-500">{r.task_code ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {knowledge.length > 0 && (
        <Section
          title={`Estimating knowledge (${knowledge.length})`}
          description="Scope-of-work rules and standards captured for the matching technical categories."
          className="mt-8"
        >
          <ul className="space-y-2">
            {knowledge.map((k) => (
              <li key={k.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                  <Pill tone="brand">{k.knowledge_type}</Pill>
                  {k.scope_technical_category ? <Pill tone="slate">{k.scope_technical_category}</Pill> : null}
                  {k.scope_service_type ? <span>· {k.scope_service_type}</span> : null}
                  <span className="ml-auto text-[10px] uppercase tracking-wide">{k.scope_level}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">{k.content}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </PageShell>
  );
}
