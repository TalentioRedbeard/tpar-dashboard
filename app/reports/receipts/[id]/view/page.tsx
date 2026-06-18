// /reports/receipts/[id]/view — popup detail for one receipt, opened in a separate
// window from the reconciliation list (so the assign controls stay visible in the main
// window while the office reads the receipt). Leadership-gated by inheritance (the
// /reports layout) + a defensive self-check. Shows EVERYTHING captured: the original
// PO/memo (raw_po — the assignment-decisive field for the spreadsheet-sourced receipts),
// source file, line items, notes, and the scanned image when one exists. Most of the
// current queue (Locke/credit-card/Winnelson from weekly payroll sheets) has no image —
// for those, raw_po + source_file are the document.

import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receipt · TPAR-DB" };

const money = (n: unknown) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type LineItem = { description?: string; quantity?: number; unit_price?: number; line_total?: number };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="text-sm text-neutral-900">{children}</dd>
    </div>
  );
}

export default async function ReceiptViewPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentTech().catch(() => null);
  if (!me) redirect("/login");
  if (!me.isAdmin && !me.isManager) redirect("/me");
  const { id } = await params;
  const supa = db();

  const { data: r } = await supa
    .from("receipts_master")
    .select("id, vendor_description, amount, transaction_date, source, tech_name, card_last4, invoice_number, is_overhead, raw_po, source_file, source_section, week_label, notes, photo_url, has_paper_receipt, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!r) notFound();

  const { data: ex } = await supa
    .from("receipt_extractions")
    .select("line_items, total_extracted, payment_method, confidence")
    .eq("receipt_id", id)
    .maybeSingle();
  const items: LineItem[] = Array.isArray(ex?.line_items) ? (ex!.line_items as LineItem[]) : [];

  const status = r.is_overhead ? "Overhead" : r.invoice_number ? `Attached · #${r.invoice_number}` : "Unattributed";

  return (
    <main className="mx-auto max-w-2xl px-5 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200 pb-3">
        <h1 className="text-lg font-semibold text-neutral-900">{r.vendor_description ?? "(unknown vendor)"}</h1>
        <span className="font-mono text-lg text-neutral-900">{money(r.amount)}</span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Field label="Date">{r.transaction_date ?? "—"}</Field>
        <Field label="Source">{r.source ?? "—"}</Field>
        <Field label="Status">
          <span className={r.is_overhead ? "text-amber-700" : r.invoice_number ? "text-emerald-700" : "text-neutral-500"}>{status}</span>
        </Field>
        {r.tech_name ? <Field label="Tech / who">{r.tech_name}</Field> : null}
        {r.card_last4 ? <Field label="Card">···{r.card_last4}</Field> : null}
        {r.week_label ? <Field label="Week">{r.week_label}</Field> : null}
      </dl>

      {r.raw_po ? (
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-brand-700">Original PO / memo</p>
          <p className="mt-0.5 font-mono text-sm text-neutral-900">{r.raw_po}</p>
          <p className="mt-1 text-xs text-neutral-500">
            This is the note from the source. A job/invoice number here (e.g. <span className="font-mono">#27689304</span>) is the job to attach to; “van stock”, “shop”, “truck”, or a tech name usually means overhead.
          </p>
        </div>
      ) : null}

      {r.notes ? (
        <div className="mt-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Notes</p>
          <p className="text-sm text-neutral-900 whitespace-pre-wrap">{r.notes}</p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="mt-4">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">Line items ({items.length})</p>
          <table className="w-full text-sm">
            <tbody>
              {items.map((li, i) => (
                <tr key={i} className="border-b border-neutral-100">
                  <td className="py-1 pr-2 text-neutral-900">{li.description ?? "item"}</td>
                  <td className="py-1 pr-2 text-right text-neutral-500">{li.quantity != null ? `×${li.quantity}` : ""}</td>
                  <td className="py-1 text-right font-mono text-neutral-900">{li.line_total != null ? money(li.line_total) : li.unit_price != null ? money(li.unit_price) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {r.photo_url ? (
        <div className="mt-4">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">Scanned receipt</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.photo_url} alt="receipt" className="w-full rounded-lg border border-neutral-200" />
          <a href={r.photo_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand-600 hover:underline">Open full image ↗</a>
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3 text-xs text-neutral-500">
          No scanned image on file — this receipt was captured from{" "}
          <span className="font-mono">{r.source_file ?? "an import"}</span>
          {r.source_section ? <> (section <span className="font-mono">{r.source_section}</span>)</> : null}.
          Use the PO/memo above to decide where it belongs.
        </p>
      )}
    </main>
  );
}
