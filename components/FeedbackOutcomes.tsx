// FeedbackOutcomes — the "Heard" card on /me (spec §3d): the closed loop of
// the daily wrap. Open items show a quiet "with Danny · age" (Danny chose
// visible latency — the honest version); answered items show his actual words
// with In-motion / Shipped chips and a "Got it" ack. Renders in BOTH simple
// and full /me modes — simple-mode techs are the exact audience. Hidden
// entirely when the tech has zero items (no empty shell). Server component;
// the EntityFlags outcome pattern is the house precedent.

import { db } from "../lib/supabase";
import { FeedbackAckButton } from "./FeedbackAckButton";

type Item = {
  id: string;
  source_kind: string;
  wrap_date: string;
  summary: string;
  status: string;
  response_note: string | null;
  responded_by: string | null;
  responded_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
};

const ageDays = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
const who = (email: string | null) => (email ?? "?").split("@")[0];

function statusChip(s: string): { label: string; cls: string } | null {
  if (s === "implementing") return { label: "🔨 In motion — task made", cls: "bg-brand-100 text-brand-800" };
  if (s === "shipped") return { label: "🚀 Shipped", cls: "bg-emerald-100 text-emerald-800" };
  if (s === "explained") return { label: "the honest no", cls: "bg-neutral-100 text-neutral-600" };
  return null;
}

export async function FeedbackOutcomes({ techShortName, readOnly = false }: { techShortName: string; readOnly?: boolean }) {
  const supa = db();
  // Open items + answered-in-14d + anything answered-but-unacknowledged.
  const { data } = await supa
    .from("feedback_items")
    .select("id, source_kind, wrap_date, summary, status, response_note, responded_by, responded_at, acknowledged_at, created_at")
    .eq("tech", techShortName)
    .neq("status", "merged")
    .order("created_at", { ascending: false })
    .limit(40);
  const rows = ((data ?? []) as Item[]).filter((r) =>
    r.status === "open"
      ? true
      : !r.acknowledged_at || (r.responded_at != null && ageDays(r.responded_at) <= 14),
  );
  if (rows.length === 0) return null; // no empty shell — the card earns its space

  const open = rows.filter((r) => r.status === "open");
  const answered = rows.filter((r) => r.status !== "open" && r.responded_at);

  return (
    <section className="mb-8 rounded-2xl border border-brand-200 bg-white p-4" id="heard">
      <h2 className="text-sm font-semibold text-neutral-900">
        👂 Heard <span className="font-normal text-neutral-500">— what you said in your wraps, and what came back</span>
      </h2>

      {answered.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {answered.map((r) => {
            const chip = statusChip(r.status);
            const acked = !!r.acknowledged_at;
            return (
              <li key={r.id} className={`rounded-xl border px-3 py-2.5 ${acked ? "border-neutral-100 bg-neutral-50/60" : "border-emerald-200 bg-emerald-50/60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="text-neutral-600">You said: <span className="italic">&ldquo;{r.summary}&rdquo;</span></div>
                    <div className="mt-1 text-neutral-900">
                      <span className="font-medium">{who(r.responded_by)}:</span> {r.response_note}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                      {chip ? <span className={`rounded-full px-2 py-0.5 font-medium ${chip.cls}`}>{chip.label}</span> : null}
                      <span>{r.responded_at ? (ageDays(r.responded_at) === 0 ? "today" : `${ageDays(r.responded_at)}d ago`) : ""}</span>
                    </div>
                  </div>
                  {!acked && !readOnly ? <FeedbackAckButton id={r.id} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {open.length > 0 ? (
        <div className="mt-3 space-y-1">
          {open.map((r) => (
            <div key={r.id} className="flex items-baseline justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600">
              <span className="min-w-0 truncate italic">&ldquo;{r.summary}&rdquo;</span>
              <span className="shrink-0 text-neutral-400">with Danny · {ageDays(r.created_at) === 0 ? "today" : `${ageDays(r.created_at)}d`}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
