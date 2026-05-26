"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Tech = { tech_short_name: string; hcp_full_name: string; hcp_employee_id: string; is_lead: boolean | null };
type CustomerHit = {
  hcp_customer_id: string;
  display_name: string;
  email: string | null;
  phone10: string | null;
  addresses: Array<{ address_id: string; street: string; city: string }>;
};
type CreateJobResult = { ok: true; hcp_job_id: string } | { ok: false; error: string };

export function CreateJobForm({
  action,
  searchCustomers,
  techs,
}: {
  action: (fd: FormData) => Promise<CreateJobResult>;
  searchCustomers: (q: string) => Promise<CustomerHit[]>;
  techs: Tech[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [searchQ, setSearchQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [isSearching, setSearching] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerHit | null>(null);
  const [selectedAddrId, setSelectedAddrId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ id: string } | null>(null);

  const tomorrow = new Date(Date.now() + 86_400_000);
  const tomorrowYmd = tomorrow.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  async function doSearch(q: string) {
    setSearchQ(q);
    setSelectedCustomer(null);
    setSelectedAddrId("");
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const r = await searchCustomers(q);
      setHits(r);
    } finally {
      setSearching(false);
    }
  }

  function pickCustomer(c: CustomerHit) {
    setSelectedCustomer(c);
    setSelectedAddrId(c.addresses[0]?.address_id ?? "");
    setHits([]);
    setSearchQ(c.display_name);
  }

  function onSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    if (!selectedCustomer || !selectedAddrId) {
      setError("Pick a customer + address first.");
      return;
    }
    formData.set("customer_id", selectedCustomer.hcp_customer_id);
    formData.set("address_id", selectedAddrId);
    startTransition(async () => {
      const res = await action(formData);
      if (res.ok) setSuccess({ id: res.hcp_job_id });
      else setError(res.error);
    });
  }

  return (
    <form action={onSubmit} className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-5">
      <div>
        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Customer (search by name, email, or phone)</span>
          <input
            type="search"
            value={searchQ}
            onChange={(e) => doSearch(e.target.value)}
            placeholder="e.g. dunlop / steve@ / 9182223333"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
        {isSearching && <div className="mt-1 text-xs text-neutral-500">Searching…</div>}
        {hits.length > 0 && (
          <ul className="mt-2 max-h-64 overflow-y-auto rounded-md border border-neutral-200 bg-white">
            {hits.map((h) => (
              <li key={h.hcp_customer_id}>
                <button
                  type="button"
                  onClick={() => pickCustomer(h)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                >
                  <div className="font-medium text-neutral-900">{h.display_name}</div>
                  <div className="text-xs text-neutral-600">
                    {h.email ?? "(no email)"} · {h.phone10 ?? "(no phone)"} · {h.addresses.length} addr
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selectedCustomer && (
          <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
            Selected: <span className="font-medium">{selectedCustomer.display_name}</span> ({selectedCustomer.hcp_customer_id})
          </div>
        )}
      </div>

      {selectedCustomer && selectedCustomer.addresses.length > 0 && (
        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Address</span>
          <select
            value={selectedAddrId}
            onChange={(e) => setSelectedAddrId(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            {selectedCustomer.addresses.map((a) => (
              <option key={a.address_id} value={a.address_id}>
                {a.street}{a.city ? `, ${a.city}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Tech</span>
          <select name="tech_employee_id" required defaultValue="" className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
            <option value="">Choose a tech…</option>
            {techs.map((t) => (
              <option key={t.hcp_employee_id} value={t.hcp_employee_id}>
                {t.tech_short_name}{t.is_lead ? " (lead)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Date (Chicago)</span>
          <input type="date" name="date" required defaultValue={tomorrowYmd} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Start time (Chicago)</span>
          <input type="time" name="start_time" required defaultValue="09:00" className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Duration (min)</span>
          <input type="number" name="duration_min" min="15" max="600" step="15" defaultValue={120} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Arrival window (min)</span>
          <input type="number" name="arrival_window_minutes" min="0" max="240" step="15" defaultValue={60} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-neutral-700">Description (visible on HCP job)</span>
        <textarea name="description" rows={2} required placeholder="e.g. Faucet leak; clogged drain; estimate visit" className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
      </label>

      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" name="notify_customer" className="h-4 w-4 rounded border-neutral-300" />
        <span>Notify the customer (uncheck for test runs)</span>
      </label>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span className="font-medium">Couldn&apos;t create job:</span> {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Created job <code className="font-mono text-xs">{success.id}</code>. Webhook will propagate to /dispatch in ~30s.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={isPending || !selectedCustomer || !selectedAddrId} className="rounded-md bg-brand-700 px-5 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {isPending ? "Creating…" : "Create job"}
        </button>
        <button type="button" onClick={() => router.push("/dispatch")} className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
