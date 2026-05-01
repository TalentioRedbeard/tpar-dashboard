// Maintenance agreements — all customers, all statuses, sortable by next-due.

import Link from "next/link";
import { db } from "../../../lib/supabase";
import { PageShell } from "../../../components/PageShell";

export const metadata = { title: "Maintenance agreements · TPAR-DB" };

type Row = {
  id: number;
  hcp_customer_id: string;
  customer_name: string;
  scope_text: string;
  cadence_days: number | null;
  base_price: string | number | null;
  starts_on: string;
  status: string;
  origin_pattern: string | null;
  next_visit_eta: string | null;
  author_email: string;
};

export default async function AgreementsReport() {
  const supa = db();
  const { data } = await supa
    .from("maintenance_agreements_v")
    .select("*")
    .order("status", { ascending: true })
    .order("next_visit_eta", { ascending: true, nullsFirst: false });
  const rows = (data ?? []) as Row[];
  const active = rows.filter((r) => r.status === "active");
  const other = rows.filter((r) => r.status !== "active");

  return (
    <PageShell
      title="Maintenance agreements"
      description={`${rows.length} agreement${rows.length === 1 ? "" : "s"} on file · ${active.length} active. v0 — execution (auto-schedule) is v1.`}
    >
      <Section title="Active" rows={active} emptyText="No active agreements yet." />
      {other.length > 0 ? <Section title="Paused / canceled / completed" rows={other} muted /> : null}
    </PageShell>
  );
}

function Section({ title, rows, emptyText, muted }: { title: string; rows: Row[]; emptyText?: string; muted?: boolean }) {
  return (
    <section className="mb-8">
      <h2 className={`mb-3 text-sm font-semibold ${muted ? "text-neutral-500" : "text-neutral-800"}`}>{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">{emptyText ?? "—"}</p>
      ) : (
        <div className={`overflow-x-auto rounded-2xl border border-neutral-200 bg-white ${muted ? "opacity-80" : ""}`}>
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Scope</th>
                <th className="px-3 py-2 text-right">Cadence</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">Next ETA</th>
                <th className="px-3 py-2 text-left">Started</th>
                <th className="px-3 py-2 text-left">Origin</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100">
                  <td className="px-3 py-2 font-medium text-neutral-900">
                    <Link href={`/customer/${r.hcp_customer_id}`} className="hover:underline">
                      {r.customer_name}
                    </Link>
                  </td>
                  <td className="max-w-md px-3 py-2 text-xs text-neutral-700">
                    <div className="line-clamp-2">{r.scope_text}</div>
                  </td>
                  <td className="px-3 py-2 text-right">{r.cadence_days ? `${r.cadence_days}d` : "—"}</td>
                  <td className="px-3 py-2 text-right">{r.base_price != null ? `$${Number(r.base_price).toLocaleString()}` : "—"}</td>
                  <td className="px-3 py-2 text-right text-neutral-600">{r.next_visit_eta ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-neutral-600">{r.starts_on}</td>
                  <td className="px-3 py-2 text-xs text-neutral-600">{r.origin_pattern ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        r.status === "active"
                          ? "bg-emerald-50 text-emerald-800"
                          : r.status === "paused"
                          ? "bg-amber-50 text-amber-800"
                          : "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
