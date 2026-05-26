"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Loc = { customer_id: string; address_id: string; street: string; city: string };
type Tech = { tech_short_name: string; hcp_full_name: string; hcp_employee_id: string; is_lead: boolean | null };
type CreateEventResult = { ok: true; hcp_job_id: string } | { ok: false; error: string };

export function CreateEventForm({
  action,
  locations,
  techs,
}: {
  action: (fd: FormData) => Promise<CreateEventResult>;
  locations: Loc[];
  techs: Tech[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Default date = tomorrow in Chicago (most common case for booking events)
  const tomorrow = new Date(Date.now() + 86_400_000);
  const tomorrowYmd = tomorrow.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  function onSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await action(formData);
      if (res.ok) {
        setSuccess(`Created job ${res.hcp_job_id}. Webhook will surface it on /dispatch in ~30s.`);
        // Don't auto-navigate — let user see confirmation, then they can go back.
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Location</span>
          <select
            name="location_key"
            required
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            onChange={(e) => {
              const selected = locations.find((l) => `${l.customer_id}|${l.address_id}` === e.target.value);
              const cid = document.querySelector<HTMLInputElement>("input[name='customer_id']");
              const aid = document.querySelector<HTMLInputElement>("input[name='address_id']");
              if (cid && selected) cid.value = selected.customer_id;
              if (aid && selected) aid.value = selected.address_id;
            }}
          >
            <option value="">Choose a location…</option>
            {locations.map((l) => (
              <option key={l.address_id} value={`${l.customer_id}|${l.address_id}`}>
                {l.street}{l.city ? `, ${l.city}` : ""}
              </option>
            ))}
          </select>
          <input type="hidden" name="customer_id" defaultValue={locations[0]?.customer_id ?? ""} />
          <input type="hidden" name="address_id" defaultValue={locations[0]?.address_id ?? ""} />
        </label>

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
          <input type="time" name="start_time" required defaultValue="08:00" className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Duration (min)</span>
          <input type="number" name="duration_min" min="15" max="600" step="15" defaultValue={60} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-neutral-700">Description</span>
        <textarea name="description" rows={2} placeholder="e.g. Equipment day — restock van; Team training" className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
      </label>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span className="font-medium">Couldn&apos;t create event:</span> {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {success}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand-700 px-5 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {isPending ? "Creating…" : "Create event"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/dispatch")}
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
