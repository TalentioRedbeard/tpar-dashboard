// Estimate badge data loader (2026-06-19). Thin server wrapper over the batched
// RPC public.estimates_for_cards — ONE round-trip resolves the HCP estimates tied
// to every card on a page (schedule grid / job / /me). Solves the N+1.
//
// Source of truth is hcp_estimates_raw (real HCP estimates), reached ONLY through
// the RPC — we never pull the `raw` jsonb client-side. The RPC already does the
// money math (MAX option total /100, never SUM) and the customer-thread cap, so
// dollars here are DOLLARS (do NOT divide again).
//
// Each RPC row carries match_job_id XOR match_customer_id (by which thread tied
// it). We fan the rows into two Maps; a card looks itself up by BOTH ids and
// merges, deduping by hcp_estimate_id keeping the strongest link_source
// (appointment > job_link > customer).

import { db } from "./supabase";

export type CardEstimate = {
  hcp_estimate_id: string;
  estimate_number: string | null;
  status: string | null;
  display_status: string;
  total_dollars: number | null;
  min_dollars: number | null;
  option_count: number;
  link_source: "appointment" | "job_link" | "customer";
  hcp_url: string;
  est_created_at: string | null;
  customer_overflow: number;
};

type RpcRow = CardEstimate & {
  match_job_id: string | null;
  match_customer_id: string | null;
};

export type CardEstimateMaps = {
  byJob: Map<string, CardEstimate[]>;
  byCustomer: Map<string, CardEstimate[]>;
};

const EMPTY: CardEstimateMaps = { byJob: new Map(), byCustomer: new Map() };

const PRECEDENCE: Record<CardEstimate["link_source"], number> = {
  appointment: 1,
  job_link: 2,
  customer: 3,
};

/**
 * Batch-load the estimates tied to a page's cards. Pass the page's distinct job
 * ids + customer ids; get back two Maps. Call ONCE per page, never per card.
 */
export async function getEstimatesForCards(
  jobIds: (string | null | undefined)[],
  customerIds: (string | null | undefined)[],
  customerCap = 6,
): Promise<CardEstimateMaps> {
  const jIds = [...new Set(jobIds.filter((x): x is string => !!x))];
  const cIds = [...new Set(customerIds.filter((x): x is string => !!x))];
  if (jIds.length === 0 && cIds.length === 0) return EMPTY;

  const { data, error } = await db().rpc("estimates_for_cards", {
    p_job_ids: jIds,
    p_customer_ids: cIds,
    p_customer_cap: customerCap,
  });
  if (error || !data) return EMPTY;

  const byJob = new Map<string, CardEstimate[]>();
  const byCustomer = new Map<string, CardEstimate[]>();
  for (const r of data as RpcRow[]) {
    const est: CardEstimate = {
      hcp_estimate_id: r.hcp_estimate_id,
      estimate_number: r.estimate_number,
      status: r.status,
      display_status: r.display_status,
      total_dollars: r.total_dollars == null ? null : Number(r.total_dollars),
      min_dollars: r.min_dollars == null ? null : Number(r.min_dollars),
      option_count: Number(r.option_count) || 0,
      link_source: r.link_source,
      hcp_url: r.hcp_url,
      est_created_at: r.est_created_at,
      customer_overflow: Number(r.customer_overflow) || 0,
    };
    if (r.match_job_id) {
      const arr = byJob.get(r.match_job_id);
      if (arr) arr.push(est);
      else byJob.set(r.match_job_id, [est]);
    }
    if (r.match_customer_id) {
      const arr = byCustomer.get(r.match_customer_id);
      if (arr) arr.push(est);
      else byCustomer.set(r.match_customer_id, [est]);
    }
  }
  return { byJob, byCustomer };
}

/**
 * Per-card merge: combine the card's job-thread + customer-thread estimates,
 * dedup by hcp_estimate_id keeping the strongest link_source, and drop the
 * card's OWN estimate (anti-self-reference for estimate-type appointment cards).
 */
export function estimatesForCard(
  maps: CardEstimateMaps,
  jobId: string | null | undefined,
  customerId: string | null | undefined,
  ownEstimateId?: string | null,
): CardEstimate[] {
  const merged = [
    ...(jobId ? maps.byJob.get(jobId) ?? [] : []),
    ...(customerId ? maps.byCustomer.get(customerId) ?? [] : []),
  ];
  const best = new Map<string, CardEstimate>();
  for (const e of merged) {
    if (ownEstimateId && e.hcp_estimate_id === ownEstimateId) continue; // anti-self-reference
    const prev = best.get(e.hcp_estimate_id);
    if (!prev || PRECEDENCE[e.link_source] < PRECEDENCE[prev.link_source]) {
      best.set(e.hcp_estimate_id, e);
    }
  }
  return [...best.values()];
}
