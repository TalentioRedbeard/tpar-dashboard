// /manage/sends — the sends ledger (build plan 2026-07-13 section 2.5): one
// chronological list of everything customer-facing that left the system,
// whatever lane it took — our tracked estimate emails + follow-ups
// (estimate_sends), HCP's own estimate emails (estimate.sent webhook events),
// outbound texts (communication_events channel='text'), and campaign emails.
// Staff [TEST] sends are shown dimmed, not hidden — an honest ledger lists
// everything that actually went out. Bounces/failures already feed the
// /manage exception rail; this page is the full record. Gated by the /manage
// layout. NO new views (house law) — merged server-side from the four sources.

import { PageShell } from "../../../components/PageShell";
import { db } from "../../../lib/supabase";
import { SendsLedger, type LedgerRow } from "./SendsLedger";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sends · Manage · TPAR-DB" };

const CAP = 300;

export default async function ManageSendsPage() {
  const supa = db();
  const [estRes, hcpRes, textRes, campRes] = await Promise.all([
    supa
      .from("estimate_sends")
      .select("kind, to_email, status, sent_at, hcp_estimate_id, opened_at, first_viewed_at, view_count")
      .not("status", "eq", "sending")
      .order("sent_at", { ascending: false })
      .limit(150),
    supa
      .from("events_log")
      .select("occurred_at, subject_id")
      .eq("event_type", "estimate.sent")
      .order("occurred_at", { ascending: false })
      .limit(100),
    supa
      .from("communication_events")
      .select("occurred_at, customer_name, counterparty, tech_short_name, summary, content_text, hcp_customer_id")
      .eq("channel", "text")
      .eq("direction", "outbound")
      .order("occurred_at", { ascending: false })
      .limit(150),
    supa
      .from("campaign_sends")
      .select("created_at, campaign_key, email, first_name, subject, status, dry_run")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  // One batched name/number lookup for every estimate id in play.
  const estRows = (estRes.data ?? []) as Array<Record<string, unknown>>;
  const hcpRows = (hcpRes.data ?? []) as Array<Record<string, unknown>>;
  const estimateIds = [
    ...new Set([
      ...estRows.map((r) => String(r.hcp_estimate_id ?? "")),
      ...hcpRows.map((r) => String(r.subject_id ?? "")),
    ].filter(Boolean)),
  ];
  const pipeById = new Map<string, { name: string | null; num: string | null }>();
  if (estimateIds.length) {
    const { data: pipes } = await supa
      .from("estimate_pipeline_v")
      .select("hcp_estimate_id, customer_name, estimate_number")
      .in("hcp_estimate_id", estimateIds);
    for (const p of (pipes ?? []) as Array<Record<string, unknown>>) {
      pipeById.set(String(p.hcp_estimate_id), {
        name: (p.customer_name as string | null) ?? null,
        num: (p.estimate_number as string | null) ?? null,
      });
    }
  }

  const rows: LedgerRow[] = [];

  for (const r of estRows) {
    if (!r.sent_at) continue;
    const eid = String(r.hcp_estimate_id ?? "");
    const pipe = pipeById.get(eid);
    const isTest = r.kind === "test";
    const viewed = !!r.first_viewed_at;
    const opened = !!r.opened_at;
    const bad = r.status === "failed" || r.status === "bounced" || r.status === "complained";
    rows.push({
      ts: String(r.sent_at),
      lane: isTest ? "test" : r.kind === "followup" ? "followup" : "estimate",
      who: pipe?.name ?? String(r.to_email ?? "?"),
      detail: `${pipe?.num ? `#${pipe.num} ` : ""}→ ${String(r.to_email ?? "?")}`,
      status: bad
        ? String(r.status)
        : viewed
          ? `viewed${Number(r.view_count) > 1 ? ` ×${r.view_count}` : ""}`
          : opened
            ? "opened"
            : String(r.status ?? ""),
      statusTone: bad ? "bad" : viewed || opened ? "good" : "ok",
      href: eid ? `/estimate/${eid}` : null,
    });
  }

  for (const r of hcpRows) {
    const eid = String(r.subject_id ?? "");
    const pipe = pipeById.get(eid);
    rows.push({
      ts: String(r.occurred_at),
      lane: "hcp",
      who: pipe?.name ?? "Unknown customer",
      detail: `${pipe?.num ? `#${pipe.num} ` : ""}sent by HCP's own email (no open/view tracking)`,
      status: "sent",
      statusTone: "muted",
      href: eid ? `/estimate/${eid}` : null,
    });
  }

  for (const r of (textRes.data ?? []) as Array<Record<string, unknown>>) {
    const body = (r.summary as string | null) ?? (r.content_text as string | null) ?? "";
    rows.push({
      ts: String(r.occurred_at),
      lane: "text",
      who: (r.customer_name as string | null) ?? String(r.counterparty ?? "?"),
      detail: `${r.tech_short_name ? `${r.tech_short_name}: ` : ""}${body.slice(0, 140)}`,
      status: null,
      statusTone: "muted",
      href: r.hcp_customer_id ? `/customer/${r.hcp_customer_id}` : null,
    });
  }

  for (const r of (campRes.data ?? []) as Array<Record<string, unknown>>) {
    rows.push({
      ts: String(r.created_at),
      lane: "campaign",
      who: [r.first_name, r.email].filter(Boolean).join(" · ") || "?",
      detail: `${r.dry_run ? "[DRY RUN] " : ""}${String(r.subject ?? r.campaign_key ?? "")}`,
      status: String(r.status ?? ""),
      statusTone: r.status === "failed" ? "bad" : "ok",
      href: null,
    });
  }

  rows.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  const capped = rows.slice(0, CAP);

  return (
    <PageShell
      icon="📨"
      title="Sends ledger"
      description="Everything customer-facing that left the system, newest first — tracked estimate emails, HCP's own sends, outbound texts, campaigns. Staff [TEST] sends shown dimmed. Failures also land on the Manage exception rail."
      backHref="/manage"
      backLabel="Manage"
    >
      <SendsLedger rows={capped} />
      {rows.length > CAP ? (
        <p className="mt-2 text-xs text-neutral-500">Showing the {CAP} most recent — use search to narrow.</p>
      ) : null}
    </PageShell>
  );
}
