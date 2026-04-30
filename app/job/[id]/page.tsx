// Per-job 360 view
import { db } from "@/lib/supabase";
import Link from "next/link";
import { NoteForm } from "../../../components/NoteForm";
import { addJobNote } from "../../../lib/notes-actions";

export const dynamic = "force-dynamic";

type JobNote = {
  id: string;
  hcp_job_id: string;
  author_email: string;
  body: string;
  created_at: string;
};

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = db();

  const { data: jobRow } = await supabase
    .from("job_360")
    .select("*")
    .eq("hcp_job_id", id)
    .maybeSingle();

  if (!jobRow) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <Link href="/" className="text-sm text-zinc-500 hover:underline">← Today</Link>
        <h1 className="text-2xl font-bold mt-3">Job not found</h1>
        <p className="text-sm text-zinc-500 mt-2">No job_360 row for <code className="px-1 py-0.5 bg-zinc-100 rounded">{id}</code></p>
      </main>
    );
  }

  const j = jobRow as Record<string, unknown>;
  const customerId = j.hcp_customer_id as string | null;

  // Pull the appointment-window communications for this customer,
  // similar past jobs, and operator notes in parallel
  const [{ data: comms }, similarRes, notesRes] = await Promise.all([
    customerId
      ? supabase
          .from("communication_events")
          .select("id, occurred_at, channel, direction, importance, sentiment, flags, tech_short_name, summary")
          .eq("hcp_customer_id", customerId)
          .order("occurred_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supabase.rpc("job_similar_to", { target_id: id, n: 6 }),
    supabase
      .from("job_notes")
      .select("id, hcp_job_id, author_email, body, created_at")
      .eq("hcp_job_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const notes = (notesRes.data ?? []) as JobNote[];

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-8">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">← Today</Link>
        <h1 className="text-3xl font-bold mt-2">{j.customer_name as string ?? id}</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {(j.street as string) ?? ""} {(j.city as string) ?? ""} ·
          <span className="font-mono ml-1">{id}</span>
          {customerId && (<> · <Link href={`/customer/${customerId}`} className="hover:underline">customer 360 →</Link></>)}
        </p>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Date" value={(j.job_date as string) ?? "—"} />
        <Stat label="Tech" value={(j.tech_primary_name as string) ?? "—"} />
        <Stat label="Status" value={(j.appointment_status as string) ?? (j.status as string) ?? "—"} />
        <Stat label="Crew size" value={(j.crew_size as number) ?? "—"} />

        <Stat label="Revenue" value={j.revenue != null ? `$${Number(j.revenue).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"} />
        <Stat label="Materials" value={j.materials_cost != null ? `$${Number(j.materials_cost).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"} />
        <Stat label="Gross margin" value={j.gross_margin_pct != null ? `${Number(j.gross_margin_pct).toFixed(0)}%` : "—"} />
        <Stat label="Receipts cost" value={j.receipts_cost != null ? `$${Number(j.receipts_cost).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"} />

        <Stat label="GPS matched" value={j.gps_matched ? "yes" : "no"} tone={j.gps_matched ? "green" : "neutral"} />
        <Stat label="On time" value={j.on_time === true ? "yes" : j.on_time === false ? "late" : "—"} tone={j.on_time === false ? "amber" : j.on_time === true ? "green" : "neutral"} />
        <Stat label="Min on site" value={(j.time_on_site_minutes as number) ?? "—"} />
        <Stat label="Min early" value={(j.minutes_early as number) ?? "—"} />

        <Stat label="Comms (this job)" value={j.comm_count_for_job as number ?? 0} />
        <Stat label="Comms 30d window" value={j.comm_count_customer_30d_window as number ?? 0} />
        <Stat label="Open follow-ups (cust)" value={j.open_followups_for_customer as number ?? 0} tone={Number(j.open_followups_for_customer) > 0 ? "amber" : "neutral"} />
        <Stat label="Photos" value={j.photo_count as number ?? 0} />
      </section>

      {Array.isArray(j.topics_in_window) && j.topics_in_window.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 mb-2">Topics in 14-day window</h2>
          <div className="flex flex-wrap gap-1">
            {(j.topics_in_window as string[]).map((t) => (
              <span key={t} className="inline-flex px-2 py-0.5 rounded-full text-xs bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200">{t}</span>
            ))}
          </div>
        </section>
      )}

      {Array.isArray(similarRes.data) && (similarRes.data as Array<Record<string, unknown>>).length > 0 && (() => {
        const rows = similarRes.data as Array<Record<string, unknown>>;
        const revenues = rows
          .map((r) => Number(r.revenue))
          .filter((v) => Number.isFinite(v) && v > 0);
        const avg = revenues.length > 0 ? revenues.reduce((a, b) => a + b, 0) / revenues.length : null;
        return (
          <section>
            <h2 className="text-sm font-semibold text-zinc-500 mb-2">
              Similar past jobs
              {avg !== null && (
                <span className="ml-2 font-normal text-zinc-500">
                  · avg revenue ${avg.toLocaleString(undefined, { maximumFractionDigits: 0 })} across {revenues.length} priced
                </span>
              )}
            </h2>
            <ul className="space-y-1">
              {rows.map((s) => (
                <li key={s.hcp_job_id as string} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">
                  <Link href={`/job/${s.hcp_job_id}`} className="font-medium hover:underline">
                    {s.customer_name as string ?? "(no name)"}
                  </Link>
                  <span className="ml-2 text-xs text-zinc-500">
                    sim {Number(s.similarity).toFixed(2)}
                    {" · "}{(s.job_date as string) ?? "no date"}
                    {" · "}{(s.tech_primary_name as string) ?? "—"}
                    {" · "}{s.revenue != null ? `$${Number(s.revenue).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                    {s.gross_margin_pct != null && ` · ${Number(s.gross_margin_pct).toFixed(0)}% margin`}
                  </span>
                  <div className="text-xs text-zinc-500 italic mt-0.5 max-w-3xl whitespace-pre-line">
                    {(s.text_preview as string ?? "").slice(0, 250)}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}

      <section>
        <h2 className="text-xl font-semibold mb-3">Operator notes</h2>
        <div className="rounded border border-zinc-200 bg-white p-3 mb-3">
          <NoteForm
            action={addJobNote}
            hiddenFieldName="hcp_job_id"
            hiddenFieldValue={id}
            placeholder="Internal note about this job (not customer-facing)…"
            label="Add note"
          />
        </div>
        {notes.length > 0 ? (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded border border-zinc-200 bg-white p-3">
                <div className="text-xs text-zinc-500 mb-1">
                  {new Date(n.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}
                  {" · "}{n.author_email}
                </div>
                <p className="text-sm whitespace-pre-wrap">{n.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">No notes yet.</p>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Recent communications for this customer</h2>
        {comms && comms.length > 0 ? (
          <ul className="space-y-2">
            {comms.map((m: Record<string, unknown>) => (
              <li key={m.id as number} className="rounded border border-zinc-200 p-3">
                <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                  <span className="font-mono">{new Date(m.occurred_at as string).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}</span>
                  <span>·</span>
                  <span>{m.channel as string}</span>
                  {!!m.direction && <><span>·</span><span>{m.direction as string}</span></>}
                  {!!m.tech_short_name && <><span>·</span><span>{m.tech_short_name as string}</span></>}
                  <span className="ml-auto">imp {m.importance as number ?? "—"}</span>
                </div>
                <p className="text-sm">{m.summary as string}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-zinc-500">No communications.</p>}
      </section>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "red" | "amber" | "green" | "neutral" }) {
  const cls =
    tone === "red"   ? "text-red-700" :
    tone === "amber" ? "text-amber-700" :
    tone === "green" ? "text-green-700" :
                       "text-zinc-900";
  return (
    <div className="rounded border border-zinc-200 p-3 bg-white">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
