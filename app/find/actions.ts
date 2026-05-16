"use server";

// Server action backing AppGuide. Returns ranked candidates given a
// (possibly empty) free-text query, biased by ambient signals:
//   - tech's van last-known GPS (vehicle_last_known_position_v)
//   - today's appointments for this tech
//   - recent comms (last 60 min) involving this tech
//   - job lifecycle state (Start/Finish events)
//
// Strategy: collect a candidate set from each signal, score, return top N.
// Pure SQL + simple JS scoring — no LLM round-trip on the hot path. The
// `/ask` LLM route is reserved for the help bubble's "I can't find it" fallback.

import { db } from "../../lib/supabase";
import { getCurrentTech } from "../../lib/current-tech";

export type FinderCandidate = {
  hcp_job_id: string;
  invoice_number: string | null;
  customer_name: string | null;
  street: string | null;
  city: string | null;
  job_date: string | null;
  tech_primary_name: string | null;
  appointment_status: string | null;
  scheduled_start: string | null;
  due_amount: number | null;
  // Lifecycle state
  started_at: string | null;          // most recent Start trigger
  finished_at: string | null;         // most recent Finish trigger
  omw_at: string | null;              // most recent OMW trigger
  // Scoring
  score: number;
  reasons: string[];                  // why this came up (for UI)
  // Behavior nudges surfaced for THIS candidate
  nudges: string[];
};

const DAY_MS = 86_400_000;

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function jsSimilarity(a: string, b: string): number {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (y.includes(x) || x.includes(y)) return Math.min(x.length, y.length) / Math.max(x.length, y.length) * 0.9 + 0.1;
  // Bigram overlap
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bigrams(x);
  const B = bigrams(y);
  let common = 0;
  for (const g of A) if (B.has(g)) common++;
  const total = A.size + B.size;
  return total === 0 ? 0 : (2 * common) / total;
}

export type FinderInput = {
  query?: string;
  // Filter mode caller can pass these to restrict the candidate pool
  date_window?: "today" | "this_week" | "all";
  only_unstarted?: boolean;
  only_open_ar?: boolean;
};

export async function findJobs(input: FinderInput): Promise<{ candidates: FinderCandidate[]; ambient: AmbientSnapshot }> {
  const me = await getCurrentTech();
  if (!me?.tech?.tech_short_name) return { candidates: [], ambient: emptyAmbient() };

  const techShort = me.tech.tech_short_name;
  const techFull = me.tech.hcp_full_name ?? techShort;
  const supa = db();

  // 1) Ambient: van last known GPS + today's appointments + recent comms
  const [vanRes, schedRes, recentCommsRes] = await Promise.all([
    supa.from("vehicle_last_known_position_v")
        .select("display_name, driver_short_name, lat, lng, last_seen_at")
        .eq("driver_short_name", techShort)
        .maybeSingle(),
    // Today + tomorrow (so a tech checking near midnight still gets next-day)
    supa.from("appointments_master")
        .select("hcp_job_id, hcp_customer_id, customer_name, street, city, scheduled_start, status, tech_primary_id, tech_all_ids")
        .gte("scheduled_start", new Date(Date.now() - DAY_MS).toISOString())
        .lte("scheduled_start", new Date(Date.now() + DAY_MS).toISOString())
        .order("scheduled_start", { ascending: true })
        .limit(50),
    supa.from("communication_events")
        .select("hcp_job_id, hcp_customer_id, customer_name, occurred_at, summary, importance")
        .eq("tech_short_name", techShort)
        .gte("occurred_at", new Date(Date.now() - 3 * 3600_000).toISOString())
        .order("occurred_at", { ascending: false })
        .limit(20),
  ]);

  const van = vanRes.data as { lat?: number; lng?: number; last_seen_at?: string; display_name?: string } | null;
  const allAppts = (schedRes.data ?? []) as Array<{ hcp_job_id: string; hcp_customer_id: string; customer_name: string | null; street: string | null; city: string | null; scheduled_start: string; status: string | null; tech_primary_id: string | null; tech_all_ids: string[] | null }>;
  const recentComms = (recentCommsRes.data ?? []) as Array<{ hcp_job_id: string | null; hcp_customer_id: string | null; customer_name: string | null; occurred_at: string; summary: string | null; importance: number | null }>;

  // Filter appointments to ones THIS tech is on. appointments_master uses
  // HCP employee_id (pro_<hex>) in tech_primary_id + tech_all_ids — NOT the
  // tech_directory.tech_id short slug. Compare to hcp_employee_id.
  const myHcpEmpId = me.tech.hcp_employee_id ?? null;
  const mineToday = allAppts.filter((a) => {
    if (!myHcpEmpId) return true; // fail-open for techs without HCP mapping
    return a.tech_primary_id === myHcpEmpId || (a.tech_all_ids ?? []).includes(myHcpEmpId);
  });

  const ambient: AmbientSnapshot = {
    van: van ? {
      label: van.display_name ?? null,
      lat: typeof van.lat === "number" ? van.lat : null,
      lng: typeof van.lng === "number" ? van.lng : null,
      stopped_at: van.last_seen_at ?? null,
    } : null,
    today_count: mineToday.filter((a) => isToday(a.scheduled_start)).length,
    recent_call_customer: recentComms[0]?.customer_name ?? null,
    recent_call_when: recentComms[0]?.occurred_at ?? null,
  };

  // 2) Build candidate pool from job_360 (joined with lifecycle events)
  // Start with: today's + tomorrow's appointments. Then expand to any job
  // mentioned in recent comms. Then if query is non-trivial, query job_360
  // by customer_name fuzzy match.
  const candidateJobIds = new Set<string>();
  for (const a of mineToday) {
    if (a.hcp_job_id) candidateJobIds.add(a.hcp_job_id);
  }
  for (const c of recentComms) {
    if (c.hcp_job_id) candidateJobIds.add(c.hcp_job_id);
  }

  // Free-text query → fuzzy-match on customer_name + invoice_number in job_360
  // AND on street in appointments_master. Address fragments ("1342", "east 25th")
  // are the most common way techs reference jobs, so the street search matters.
  //
  // Two keyword classes:
  //   - "current" / "active" / "in progress" / "started" / "now" → filter to
  //     started-not-finished. Set on the candidate-side (no text search).
  //   - "open ar" / "unpaid" / "owed" → filter to due_amount > 0. Sets
  //     input.only_open_ar so the per-candidate filter applies.
  const q = (input.query ?? "").trim();
  const qLower = q.toLowerCase();
  const isCurrentKeyword = ["current", "active", "in progress", "in-progress", "started", "now"].includes(qLower);
  const isOpenArKeyword = ["open ar", "open a/r", "unpaid", "owed", "open balance", "ar"].includes(qLower);
  if (isOpenArKeyword) {
    input = { ...input, only_open_ar: true };
  }
  // Text search runs unless the query is a pure keyword.
  const skipTextSearch = isCurrentKeyword || isOpenArKeyword;

  // For open-ar keyword: pull ALL open-AR jobs into the candidate pool so the
  // filter has rows to act on (otherwise candidates come only from today's
  // appts + recent comms, which is too narrow).
  if (isOpenArKeyword) {
    const { data: arRows } = await supa
      .from("job_360")
      .select("hcp_job_id")
      .gt("due_amount", 0)
      .order("job_date", { ascending: false, nullsFirst: false })
      .limit(40);
    for (const r of (arRows ?? []) as Array<{ hcp_job_id: string }>) {
      candidateJobIds.add(r.hcp_job_id);
    }
  }

  if (q.length >= 2 && !skipTextSearch) {
    const safe = q.replace(/[%_]/g, "");
    // Tokenize on whitespace. Drop direction + street-type stop-words —
    // "south" or "ave" alone match thousands of rows in Tulsa and crowd
    // specific tokens out of the 30-row candidate-pool cap. We keep the
    // substring search on the FULL query so contiguous user-typed strings
    // ("S Jamestown") still match exactly.
    const STOP = new Set([
      "south", "north", "east", "west", "the", "and", "of",
      "st", "street", "ave", "avenue", "rd", "road", "blvd", "boulevard",
      "dr", "drive", "ct", "court", "pl", "place", "ln", "lane", "way", "cir", "circle",
    ]);
    const tokens = safe.toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !STOP.has(t));

    const customerInvoiceOr = [
      `customer_name.ilike.%${safe}%`,
      `invoice_number.ilike.%${safe}%`,
      ...tokens.flatMap((t) => [`customer_name.ilike.%${t}%`, `invoice_number.ilike.%${t}%`]),
    ].join(",");

    const streetOrFilters = [`street.ilike.%${safe}%`, ...tokens.map((t) => `street.ilike.%${t}%`)].join(",");

    const [fuzzyJobs, fuzzyStreet] = await Promise.all([
      supa.from("job_360")
        .select("hcp_job_id")
        .or(customerInvoiceOr)
        .order("job_date", { ascending: false, nullsFirst: false })
        .limit(30),
      supa.from("appointments_master")
        .select("hcp_job_id")
        .or(streetOrFilters)
        .not("hcp_job_id", "is", null)
        .order("scheduled_start", { ascending: false, nullsFirst: false })
        .limit(30),
    ]);
    for (const r of (fuzzyJobs.data ?? []) as Array<{ hcp_job_id: string }>) {
      candidateJobIds.add(r.hcp_job_id);
    }
    for (const r of (fuzzyStreet.data ?? []) as Array<{ hcp_job_id: string }>) {
      candidateJobIds.add(r.hcp_job_id);
    }

    // Trigram fallback for typos. find_jobs_fuzzy RPC returns hcp_job_ids
    // where pg_trgm similarity(customer_name, q) or similarity(invoice, q)
    // exceeds 0.3. Catches "trotzik" → Jane Trotzuk, etc.
    const { data: fuzzyRpcRows } = await supa.rpc("find_jobs_fuzzy", { q: safe, sim_threshold: 0.3, max_rows: 30 });
    for (const r of (fuzzyRpcRows ?? []) as Array<{ hcp_job_id: string }>) {
      candidateJobIds.add(r.hcp_job_id);
    }
  }

  if (candidateJobIds.size === 0) {
    return { candidates: [], ambient };
  }

  // 3) Load job_360 + appointment + lifecycle for each candidate
  const [jobsRes, apptByJobRes, lifecycleRes] = await Promise.all([
    supa.from("job_360")
        .select("hcp_job_id, invoice_number, customer_name, tech_primary_name, job_date, appointment_status, due_amount")
        .in("hcp_job_id", Array.from(candidateJobIds)),
    supa.from("appointments_master")
        .select("hcp_job_id, street, city, scheduled_start, status")
        .in("hcp_job_id", Array.from(candidateJobIds)),
    supa.from("job_lifecycle_events")
        .select("hcp_job_id, trigger_number, occurred_at")
        .in("hcp_job_id", Array.from(candidateJobIds)),
  ]);

  const jobsById = new Map<string, Record<string, unknown>>();
  for (const j of (jobsRes.data ?? []) as Array<Record<string, unknown>>) {
    jobsById.set(j.hcp_job_id as string, j);
  }
  const apptByJob = new Map<string, { street: string | null; city: string | null; scheduled_start: string | null }>();
  for (const a of (apptByJobRes.data ?? []) as Array<{ hcp_job_id: string; street: string | null; city: string | null; scheduled_start: string }>) {
    if (!apptByJob.has(a.hcp_job_id)) {
      apptByJob.set(a.hcp_job_id, { street: a.street, city: a.city, scheduled_start: a.scheduled_start });
    }
  }
  const lifecycleByJob = new Map<string, { started_at: string | null; finished_at: string | null; omw_at: string | null }>();
  for (const e of (lifecycleRes.data ?? []) as Array<{ hcp_job_id: string; trigger_number: number; occurred_at: string }>) {
    const prev = lifecycleByJob.get(e.hcp_job_id) ?? { started_at: null, finished_at: null, omw_at: null };
    if (e.trigger_number === 2) prev.omw_at = e.occurred_at;
    if (e.trigger_number === 3) prev.started_at = maxIso(prev.started_at, e.occurred_at);
    if (e.trigger_number === 6) prev.finished_at = maxIso(prev.finished_at, e.occurred_at);
    lifecycleByJob.set(e.hcp_job_id, prev);
  }

  // Customer locations for GPS distance bias
  const custIds = Array.from(new Set(
    Array.from(candidateJobIds)
      .map((id) => allAppts.find((a) => a.hcp_job_id === id)?.hcp_customer_id)
      .filter((v): v is string => !!v),
  ));
  const { data: locRows } = custIds.length > 0
    ? await supa.from("locations_master").select("customer_id_text, lat, lng").in("customer_id_text", custIds).not("lat", "is", null)
    : { data: [] };
  const locByCust = new Map<string, { lat: number; lng: number }>();
  for (const l of (locRows ?? []) as Array<{ customer_id_text: string; lat: number; lng: number }>) {
    if (!locByCust.has(l.customer_id_text)) locByCust.set(l.customer_id_text, { lat: l.lat, lng: l.lng });
  }
  // Map cust_id -> job_id (for appt-only)
  const apptCustByJob = new Map<string, string>();
  for (const a of allAppts) {
    if (a.hcp_job_id && a.hcp_customer_id && !apptCustByJob.has(a.hcp_job_id)) {
      apptCustByJob.set(a.hcp_job_id, a.hcp_customer_id);
    }
  }

  // 4) Score each candidate
  const now = Date.now();
  const candidates: FinderCandidate[] = [];
  for (const id of candidateJobIds) {
    const j = jobsById.get(id);
    if (!j) continue;
    const appt = apptByJob.get(id);
    const lifecycle = lifecycleByJob.get(id) ?? { started_at: null, finished_at: null, omw_at: null };
    const custId = apptCustByJob.get(id);
    const loc = custId ? locByCust.get(custId) : undefined;

    let score = 0;
    const reasons: string[] = [];

    // (a) Free-text similarity — name, invoice, and street
    if (q.length >= 2 && !skipTextSearch) {
      const name = String(j.customer_name ?? "");
      const inv  = String(j.invoice_number ?? "");
      const street = String(appt?.street ?? "");
      const sim = Math.max(
        jsSimilarity(q, name),
        inv ? jsSimilarity(q, inv) : 0,
        street ? jsSimilarity(q, street) : 0,
      );
      if (sim > 0.2) {
        score += sim * 100;
        reasons.push(`matches "${q}" (${(sim * 100).toFixed(0)}%)`);
      }
    }

    // Special "current" keyword: heavy bias toward started-not-finished
    if (isCurrentKeyword) {
      if (lifecycle.started_at && !lifecycle.finished_at) {
        score += 100;
        reasons.push("currently in progress");
      } else {
        // Not in progress → drop out of results for this query
        continue;
      }
    }

    // Special "open ar" / "unpaid" / "owed" keyword: rank by dollars owed.
    // Note: only_open_ar filter (set above) drops candidates without due.
    if (isOpenArKeyword) {
      const due = Number(j.due_amount ?? 0);
      if (due > 0) {
        score += 50 + due / 100; // baseline + $1-per-$100-owed
        reasons.push(`$${Math.round(due)} owed`);
      }
    }

    // (b) Today bias
    const apptStart = appt?.scheduled_start ?? null;
    if (apptStart) {
      const startMs = new Date(apptStart).getTime();
      const hoursFromNow = Math.abs(startMs - now) / 3_600_000;
      if (isToday(apptStart)) {
        score += 40;
        if (hoursFromNow < 1) {
          score += 30;
          reasons.push("scheduled within ±1h");
        } else {
          reasons.push("on today's schedule");
        }
      }
    }

    // (c) GPS bias — closer to the van wins (only if van GPS is fresh)
    if (loc && ambient.van?.lat != null && ambient.van?.lng != null && ambient.van.stopped_at) {
      const stoppedMin = (now - new Date(ambient.van.stopped_at).getTime()) / 60_000;
      if (stoppedMin < 240) {
        const miles = haversineMiles(ambient.van.lat, ambient.van.lng, loc.lat, loc.lng);
        if (miles < 0.1) {
          score += 60;
          reasons.push("you're parked here");
        } else if (miles < 0.5) {
          score += 30;
          reasons.push(`${miles.toFixed(2)}mi from your van`);
        } else if (miles < 2) {
          score += 10;
        }
      }
    }

    // (d) Recent comms bias
    const matchedComm = recentComms.find((c) => c.hcp_job_id === id || c.customer_name === j.customer_name);
    if (matchedComm) {
      const minutesAgo = (now - new Date(matchedComm.occurred_at).getTime()) / 60_000;
      if (minutesAgo < 60) {
        score += 30;
        reasons.push(`called/texted ${Math.round(minutesAgo)}m ago`);
      }
    }

    // (e) Lifecycle: started-not-finished outranks not-started for "current job" intuition
    if (lifecycle.started_at && !lifecycle.finished_at) {
      score += 20;
      reasons.push("in progress");
    }

    // (f) Open AR — only if filter requested
    const due = Number(j.due_amount ?? 0);
    if (input.only_open_ar && due <= 0) continue;
    if (input.only_unstarted && lifecycle.started_at) continue;
    if (input.date_window === "today" && !apptStart) continue;
    if (input.date_window === "today" && apptStart && !isToday(apptStart)) continue;

    // Behavior nudges
    const nudges: string[] = [];
    const apptIsCurrent = apptStart && Math.abs(new Date(apptStart).getTime() - now) < 2 * 3_600_000;
    if (apptIsCurrent && !lifecycle.omw_at && !lifecycle.started_at) nudges.push("Heads up — you haven't hit OMW yet.");
    if (apptIsCurrent && lifecycle.omw_at && !lifecycle.started_at) nudges.push("OMW logged. Hit Start when you're on-site.");
    if (lifecycle.started_at && !lifecycle.finished_at) {
      const minIn = Math.round((now - new Date(lifecycle.started_at).getTime()) / 60_000);
      if (minIn > 240) nudges.push(`Started ${Math.floor(minIn / 60)}h ${minIn % 60}m ago — if you've left, hit Finish.`);
    }

    candidates.push({
      hcp_job_id: id,
      invoice_number: j.invoice_number as string | null,
      customer_name: j.customer_name as string | null,
      street: appt?.street ?? null,
      city: appt?.city ?? null,
      job_date: j.job_date as string | null,
      tech_primary_name: j.tech_primary_name as string | null,
      appointment_status: j.appointment_status as string | null,
      scheduled_start: apptStart,
      due_amount: due > 0 ? due : null,
      started_at: lifecycle.started_at,
      finished_at: lifecycle.finished_at,
      omw_at: lifecycle.omw_at,
      score,
      reasons,
      nudges,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return { candidates: candidates.slice(0, 20), ambient };
}

export type AmbientSnapshot = {
  van: { label: string | null; lat: number | null; lng: number | null; stopped_at: string | null } | null;
  today_count: number;
  recent_call_customer: string | null;
  recent_call_when: string | null;
};

function emptyAmbient(): AmbientSnapshot {
  return { van: null, today_count: 0, recent_call_customer: null, recent_call_when: null };
}

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
