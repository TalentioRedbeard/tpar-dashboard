"use client";

// The tech customers list, searchable (Danny 2026-07-16: "a search bar with
// multiple filters and a dynamic description interpreter like jobs"). Three
// layers: instant local filtering over the full-history list (name/phone),
// filter chips (all · upcoming · recent · A–Z), and the deep interpreter —
// a debounced server search across job addresses, descriptions, and HCP
// notes with a visible WHY on every hit.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { searchMyCustomers, type CustomerHit } from "./search-actions";

export type CustRow = {
  id: string;
  name: string;
  phone: string | null;     // formatted
  rawPhone: string;         // digits for tel: + search
  apptCount: number;
  lastSeen: string | null;  // ISO
};

const CHI = "America/Chicago";
function fmtDay(s: string): string {
  return new Date(s).toLocaleDateString("en-US", { timeZone: CHI, month: "short", day: "numeric" });
}

type Chip = "all" | "upcoming" | "recent" | "az";

export function TechCustomersList({ rows }: { rows: CustRow[] }) {
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<Chip>("all");
  const [deep, setDeep] = useState<CustomerHit[] | null>(null);
  const [deepBusy, setDeepBusy] = useState(false);
  const deepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Instant local filter: name + phone digits.
  const qNorm = q.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const local = useMemo(() => {
    let out = rows;
    if (qNorm) {
      out = out.filter((r) =>
        r.name.toLowerCase().includes(qNorm) || (qDigits.length >= 4 && r.rawPhone.includes(qDigits)));
    }
    const now = Date.now();
    if (chip === "upcoming") out = out.filter((r) => r.lastSeen && new Date(r.lastSeen).getTime() > now);
    if (chip === "recent") out = out.filter((r) => r.lastSeen && now - new Date(r.lastSeen).getTime() < 90 * 86_400_000);
    if (chip === "az") out = [...out].sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [rows, qNorm, qDigits, chip]);

  // Deep interpreter: debounced; skips when the local name filter already has
  // plenty (the interpreter earns its keep on addresses/descriptions/notes).
  useEffect(() => {
    if (deepTimer.current) clearTimeout(deepTimer.current);
    setDeep(null);
    if (qNorm.length < 3) return;
    deepTimer.current = setTimeout(() => {
      setDeepBusy(true);
      searchMyCustomers({ q })
        .then((r) => setDeep(r.ok ? r.hits : []))
        .catch(() => setDeep([]))
        .finally(() => setDeepBusy(false));
    }, 450);
    return () => { if (deepTimer.current) clearTimeout(deepTimer.current); };
  }, [q, qNorm]);

  const localIds = new Set(local.map((r) => r.id));
  const deepOnly = (deep ?? []).filter((h) => !localIds.has(h.hcp_customer_id));

  const CHIPS: Array<[Chip, string]> = [
    ["all", "All"], ["upcoming", "Upcoming"], ["recent", "Last 90 days"], ["az", "A–Z"],
  ];

  return (
    <div>
      <div className="mb-3 space-y-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={'name, phone, address, or the work — "crow" / "joplin" / "tankless" / "current"'}
          className="block w-full rounded-xl border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map(([c, label]) => (
            <button key={c} type="button" onClick={() => setChip(c)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${chip === c ? "bg-brand-700 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 text-xs text-neutral-500">
        {local.length} customer{local.length === 1 ? "" : "s"}{qNorm ? " matching" : " from your work"}
        {deepBusy ? " · digging through your jobs…" : ""}
      </div>

      <ul className="space-y-2">
        {local.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
            <div className="min-w-0">
              <Link href={`/customer/${r.id}`} className="truncate text-sm font-medium text-neutral-900 hover:underline">{r.name}</Link>
              <div className="mt-0.5 text-xs text-neutral-500">
                {r.apptCount > 0 ? `${r.apptCount} appointment${r.apptCount === 1 ? "" : "s"} with you` : "from your job history"}
                {r.lastSeen ? ` · latest ${fmtDay(r.lastSeen)}` : ""}
              </div>
            </div>
            {r.phone && r.rawPhone ? (
              <a href={`tel:${r.rawPhone}`} className="shrink-0 text-sm text-brand-700 hover:underline">{r.phone}</a>
            ) : null}
          </li>
        ))}
      </ul>

      {deepOnly.length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            🧭 Found in your job history
          </div>
          <ul className="space-y-2">
            {deepOnly.map((h) => (
              <li key={h.hcp_customer_id} className="rounded-xl border border-brand-200 bg-brand-50/40 px-3 py-2.5">
                <Link href={`/customer/${h.hcp_customer_id}`} className="text-sm font-medium text-neutral-900 hover:underline">
                  {h.name ?? h.hcp_customer_id}
                </Link>
                <div className="mt-0.5 text-xs text-neutral-600">
                  {h.reason}{h.last_date ? ` · ${fmtDay(h.last_date)}` : ""}
                </div>
                {h.snippet ? <div className="mt-1 text-xs italic text-neutral-500">{h.snippet}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {qNorm && local.length === 0 && (deep?.length ?? 0) === 0 && !deepBusy ? (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-white px-4 py-6 text-center text-sm text-neutral-500">
          Nothing in your work matches “{q}”. If it&apos;s a customer you worked for, try the address or what the job was.
        </div>
      ) : null}
    </div>
  );
}
