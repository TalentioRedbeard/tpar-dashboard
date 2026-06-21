"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Tech = { tech_short_name: string; hcp_full_name: string; hcp_employee_id: string; is_lead: boolean | null };
type CustomerHit = {
  hcp_customer_id: string;
  display_name: string;
  email: string | null;
  phone10: string | null;
  addresses: Array<{ address_id: string; street: string; city: string }>;
};
type CreateJobResult = { ok: true; hcp_job_id: string } | { ok: false; error: string };
type TechDayLoad = { tech_full_name: string; appts: Array<{ start: string; end: string | null; customer: string | null; status: string | null }> };
type CustomerSnapshot = { lifetime_jobs: number; last_visit: string | null; last_tech: string | null };

type AdvisorJobInput = { description: string; customer_id?: string; customer_name?: string; address?: string; city?: string; date_chi: string; duration_min?: number };
type AdvisorRec = { tech_short_name: string; suggested_start_chi: string; fit_score: number; why: string; concerns?: string };
type AdvisorResult =
  | { ok: true; recommendations: AdvisorRec[]; overall_note: string; unschedulable_reason?: string; elapsed_ms?: number }
  | { ok: false; error: string };

function fmtClockCt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
}
function fmtDateCt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
}

export function CreateJobForm({
  action,
  searchCustomers,
  techs,
  getTechDayLoad,
  getCustomerSnapshot,
  recommend,
  initialDate,
  initialTechId,
}: {
  action: (fd: FormData) => Promise<CreateJobResult>;
  searchCustomers: (q: string) => Promise<CustomerHit[]>;
  techs: Tech[];
  getTechDayLoad: (dateChi: string) => Promise<TechDayLoad[]>;
  getCustomerSnapshot: (customerId: string) => Promise<CustomerSnapshot | null>;
  recommend: (job: AdvisorJobInput) => Promise<AdvisorResult>;
  initialDate?: string;
  initialTechId?: string;
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

  // Controlled fields (so the advisor can pre-fill tech + start time on Apply).
  const [selectedDate, setSelectedDate] = useState<string>(initialDate ?? tomorrowYmd);
  const [selectedTechId, setSelectedTechId] = useState<string>(initialTechId ?? "");
  const [startTime, setStartTime] = useState<string>("09:00");
  const [durationMin, setDurationMin] = useState<number>(120);
  const [description, setDescription] = useState<string>("");

  const [dayLoad, setDayLoad] = useState<TechDayLoad[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [snapshot, setSnapshot] = useState<CustomerSnapshot | null>(null);

  // Advisor state
  const [loadingRec, setLoadingRec] = useState(false);
  const [recs, setRecs] = useState<AdvisorRec[] | null>(null);
  const [overallNote, setOverallNote] = useState<string>("");
  const [unschedulable, setUnschedulable] = useState<string>("");
  const [recError, setRecError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return;
    setLoadingDay(true);
    getTechDayLoad(selectedDate)
      .then((d) => { if (!cancelled) setDayLoad(d); })
      .catch(() => { if (!cancelled) setDayLoad([]); })
      .finally(() => { if (!cancelled) setLoadingDay(false); });
    return () => { cancelled = true; };
  }, [selectedDate, getTechDayLoad]);

  const loadByFullName = new Map(dayLoad.map((d) => [d.tech_full_name, d]));

  async function doSearch(q: string) {
    setSearchQ(q);
    setSelectedCustomer(null);
    setSelectedAddrId("");
    setSnapshot(null);
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
    setSnapshot(null);
    setRecs(null);
    getCustomerSnapshot(c.hcp_customer_id).then((s) => setSnapshot(s)).catch(() => {});
  }

  async function getRecs() {
    if (!selectedCustomer || !description.trim()) return;
    setLoadingRec(true);
    setRecs(null);
    setOverallNote("");
    setUnschedulable("");
    setRecError("");
    const addr = selectedCustomer.addresses.find((a) => a.address_id === selectedAddrId);
    try {
      const r = await recommend({
        description: description.trim(),
        customer_id: selectedCustomer.hcp_customer_id,
        customer_name: selectedCustomer.display_name,
        address: addr?.street,
        city: addr?.city,
        date_chi: selectedDate,
        duration_min: durationMin,
      });
      if (r.ok) {
        setRecs(r.recommendations);
        setOverallNote(r.overall_note);
        setUnschedulable(r.unschedulable_reason ?? "");
      } else {
        setRecError(r.error);
      }
    } catch (e) {
      setRecError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRec(false);
    }
  }

  function applyRec(rec: AdvisorRec) {
    const t = techs.find((x) => x.tech_short_name === rec.tech_short_name);
    if (t) setSelectedTechId(t.hcp_employee_id);
    const m = rec.suggested_start_chi.match(/^(\d{1,2}):(\d{2})$/);
    if (m) setStartTime(`${m[1].padStart(2, "0")}:${m[2]}`);
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

  const canRecommend = !!selectedCustomer && description.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate);

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
        {selectedCustomer && snapshot && (
          <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
            {snapshot.lifetime_jobs > 0 ? (
              <>
                <span className="font-medium text-neutral-900">Repeat customer</span> · {snapshot.lifetime_jobs} job{snapshot.lifetime_jobs === 1 ? "" : "s"} on record · last visit {fmtDateCt(snapshot.last_visit)}{snapshot.last_tech ? ` (${snapshot.last_tech})` : ""}
                <a href={`/customer/${selectedCustomer.hcp_customer_id}`} target="_blank" rel="noreferrer" className="ml-2 font-medium text-brand-700 hover:underline">full history →</a>
              </>
            ) : (
              <><span className="font-medium text-neutral-900">New customer</span> — no prior jobs on record.</>
            )}
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

      <label className="block">
        <span className="text-xs font-medium text-neutral-700">Description (visible on HCP job)</span>
        <textarea name="description" rows={2} required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Faucet leak; clogged drain; estimate visit" className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
      </label>

      {/* Crew load for the chosen day — so she books into a gap, not blind. */}
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
            Crew load · {fmtDateCt(`${selectedDate}T12:00:00Z`)}
          </span>
          {loadingDay && <span className="text-xs text-neutral-400">checking…</span>}
        </div>
        <ul className="space-y-1">
          {techs.map((t) => {
            const load = loadByFullName.get(t.hcp_full_name);
            const n = load?.appts.length ?? 0;
            return (
              <li key={t.hcp_employee_id} className="flex items-start gap-2 text-xs">
                <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${n === 0 ? "bg-emerald-500" : n >= 4 ? "bg-red-500" : "bg-amber-500"}`} />
                <span className="w-24 shrink-0 font-medium text-neutral-800">{t.tech_short_name}{t.is_lead ? " ·L" : ""}</span>
                <span className="flex flex-wrap gap-x-2 text-neutral-600">
                  {n === 0 ? (
                    <span className="text-emerald-700">open all day</span>
                  ) : (
                    load!.appts.map((a, i) => (
                      <span key={i} className="whitespace-nowrap">
                        {fmtClockCt(a.start)}{a.end ? `–${fmtClockCt(a.end)}` : ""}{a.customer ? ` · ${a.customer.split(" ")[0]}` : ""}
                      </span>
                    ))
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Scheduling advisor — recommend, don't decide. Apply pre-fills tech + time. */}
      <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-brand-800">✨ Scheduling advisor</span>
          <button
            type="button"
            onClick={getRecs}
            disabled={!canRecommend || loadingRec}
            className="rounded-md border border-brand-300 bg-white px-3 py-1 text-xs font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-50"
            title={canRecommend ? "Recommend a tech + time for this job" : "Pick a customer, describe the job, and set a date first"}
          >
            {loadingRec ? "Thinking…" : "Recommend tech & time"}
          </button>
        </div>
        {recError && <div className="mt-2 text-xs text-red-700">Advisor unavailable: {recError}</div>}
        {overallNote && <div className="mt-2 text-xs text-neutral-700">{overallNote}</div>}
        {unschedulable && <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">{unschedulable}</div>}
        {recs && recs.length > 0 && (
          <ul className="mt-2 space-y-2">
            {recs.map((r, i) => (
              <li key={i} className="rounded-md border border-neutral-200 bg-white p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-neutral-900">
                    {r.tech_short_name}{r.suggested_start_chi ? ` · ${r.suggested_start_chi}` : ""}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-1.5 w-14 overflow-hidden rounded-full bg-neutral-200" title={`fit ${Math.round((r.fit_score ?? 0) * 100)}%`}>
                      <span className="block h-full bg-brand-500" style={{ width: `${Math.round((r.fit_score ?? 0) * 100)}%` }} />
                    </span>
                    <button type="button" onClick={() => applyRec(r)} className="rounded border border-brand-300 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800 hover:bg-brand-100">
                      Apply
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-xs text-neutral-700">{r.why}</div>
                {r.concerns ? <div className="mt-0.5 text-xs text-amber-700">⚠ {r.concerns}</div> : null}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 text-[10px] text-neutral-400">Recommendations only — you choose. Apply pre-fills the tech + start time below.</div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Tech</span>
          <select name="tech_employee_id" required value={selectedTechId} onChange={(e) => setSelectedTechId(e.target.value)} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
            <option value="">Choose a tech…</option>
            {techs.map((t) => {
              const n = loadByFullName.get(t.hcp_full_name)?.appts.length ?? 0;
              return (
                <option key={t.hcp_employee_id} value={t.hcp_employee_id}>
                  {t.tech_short_name}{t.is_lead ? " (lead)" : ""}{n > 0 ? ` — ${n} booked` : " — open"}
                </option>
              );
            })}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Date (Chicago)</span>
          <input type="date" name="date" required value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Start time (Chicago)</span>
          <input type="time" name="start_time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Duration (min)</span>
          <input type="number" name="duration_min" min="15" max="600" step="15" value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Arrival window (min)</span>
          <input type="number" name="arrival_window_minutes" min="0" max="240" step="15" defaultValue={60} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </label>
      </div>

      <label className="flex items-start gap-2 text-sm text-neutral-700">
        <input type="checkbox" name="notify_customer" defaultChecked className="mt-0.5 h-4 w-4 rounded border-neutral-300" />
        <span>Text the customer their appointment confirmation
          <span className="block text-xs text-neutral-400">On by default — uncheck for internal or test bookings. Scheduling never texts on its own.</span>
        </span>
      </label>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span className="font-medium">Couldn&apos;t create job:</span> {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div className="font-medium">✓ Job created for {selectedDate} at {startTime}.</div>
          <p className="mt-1 text-xs text-emerald-800/90">
            It shows on the schedule for <span className="font-medium">{selectedDate}</span> — today&apos;s /dispatch lanes only list <em>today&apos;s</em> jobs, and test-customer bookings are hidden from the lanes by design, so it may not appear there.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Link href={`/job/${success.id}`} className="font-medium text-emerald-800 underline hover:text-emerald-900">Open job to edit →</Link>
            <button type="button" onClick={() => setSuccess(null)} className="text-xs text-emerald-700 hover:underline">Create another</button>
          </div>
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
