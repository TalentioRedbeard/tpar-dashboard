// /job/[id]/estimate/from-voice-note — picks a voice note + scope, runs the
// "Based on..." generator, then renders EstimateBuilder pre-populated with
// the structured output. User edits + pushes via the existing path.

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/supabase";
import { PageShell } from "@/components/PageShell";
import { EstimateBuilder } from "@/components/EstimateBuilder";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentTech } from "@/lib/current-tech";
import { listVoiceNotesForJob, generateFromReference } from "../../../../voice-notes/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Estimate from voice note · TPAR-DB" };

type LineItem = { name: string; description: string; quantity: string; unit_price: string; unit_cost: string };
type Option = { name: string; line_items: LineItem[] };

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "0.00";
  return Number(n).toFixed(2);
}

// Generator's structured output → EstimateBuilder's Option[] shape.
function mapGeneratorToBuilder(output: any, scope: string): { options: Option[]; note: string } {
  const noteParts: string[] = [];

  function mapLineItem(li: any): LineItem {
    const price = Number(li.suggested_price ?? li.subtotal ?? 0);
    const cost = Number(li.labor_cost ?? 0) + Number(li.materials_cost ?? 0);
    if (li.modifiers && Array.isArray(li.modifiers) && li.modifiers.length > 0) {
      noteParts.push(`Modifiers on "${li.name}": ${li.modifiers.join(", ")}`);
    }
    if (li.confidence != null && Number(li.confidence) < 0.7) {
      noteParts.push(`Lower-confidence (${li.confidence}) on "${li.name}" — see voice-note reasoning before pushing.`);
    }
    return {
      name: String(li.name ?? ""),
      description: String(li.description ?? ""),
      quantity: "1",
      unit_price: fmtMoney(price),
      unit_cost: fmtMoney(cost),
    };
  }

  if (scope === "full_option_set" && Array.isArray(output?.options)) {
    return {
      options: output.options.map((opt: any, i: number) => ({
        name: opt.name ? `${opt.name} (Phase ${opt.level ?? i + 1})` : `Option ${i + 1}`,
        line_items: (opt.line_items ?? []).map(mapLineItem),
      })),
      note: noteParts.join("\n"),
    };
  }

  // single_line_item or add_to_option → one option, one line
  if (output?.line_item) {
    return {
      options: [{ name: "Option 1", line_items: [mapLineItem(output.line_item)] }],
      note: noteParts.join("\n"),
    };
  }

  return { options: [], note: "" };
}

export default async function FromVoiceNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ note?: string; scope?: string; extra?: string; option_summary?: string }>;
}) {
  const me = await getCurrentTech();
  if (!me) redirect("/login");
  if (!me.canWrite) {
    return (
      <PageShell title="Read-only" description="Managers can review estimates but not push them.">
        <EmptyState title="No write access." />
      </PageShell>
    );
  }

  const { id } = await params;
  const sp = await searchParams;

  const supa = db();
  const { data: job } = await supa
    .from("job_360")
    .select("hcp_job_id, hcp_customer_id, customer_name, street, city, invoice_number")
    .eq("hcp_job_id", id)
    .maybeSingle();
  if (!job) notFound();

  const customerName = (job.customer_name as string | null) ?? "(unknown)";
  const invoiceNum = (job.invoice_number as string | null) ?? id.slice(-8);
  const defaultProjectName = `Plumbing scope for ${customerName} · ${invoiceNum}`;

  // Picker mode — no note selected yet
  if (!sp.note) {
    const notes = await listVoiceNotesForJob(id);

    return (
      <PageShell
        kicker="New estimate · Based on a voice note"
        title={`${customerName} — pick a voice note`}
        description="The generator builds structured options from the note + job context, then drops you into the EstimateBuilder pre-filled."
      >
        <div className="mb-4">
          <Link href={`/job/${id}/estimate/new`} className="text-xs text-neutral-500 hover:underline">
            ← Build from scratch instead
          </Link>
        </div>

        <Section title="Voice notes attached to this job">
          {notes.length === 0 ? (
            <EmptyState
              title="No voice notes for this job yet."
              description={
                <>
                  <Link href={`/voice-notes/new?job=${id}`} className="font-medium text-brand-700 hover:underline">
                    Record one now
                  </Link>
                  {" "}— audio in the browser or upload a file. Comes back here once it&apos;s transcribed.
                </>
              }
            />
          ) : (
            <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              {notes.map((n: any) => (
                <li key={n.id} className="hover:bg-neutral-50">
                  <div className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-neutral-500">
                      <span className="font-medium text-neutral-900">
                        {n.tech_short_name ?? n.user_email ?? "—"}
                      </span>
                      <span>{new Date(n.ts).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    {n.transcript ? (
                      <p className="mt-1.5 line-clamp-3 text-xs text-neutral-700">{(n.transcript as string).slice(0, 360)}{(n.transcript as string).length > 360 ? "…" : ""}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link
                        href={`/job/${id}/estimate/from-voice-note?note=${n.id}&scope=full_option_set`}
                        className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800"
                      >
                        Generate full option set →
                      </Link>
                      <Link
                        href={`/job/${id}/estimate/from-voice-note?note=${n.id}&scope=single_line_item`}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                      >
                        Single line item
                      </Link>
                      <Link
                        href={`/voice-notes/${n.id}`}
                        className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
                      >
                        Open note
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </PageShell>
    );
  }

  // Generate mode — note + scope selected; run generator, render EstimateBuilder
  const scope = (sp.scope as "single_line_item" | "full_option_set" | "add_to_option") ?? "full_option_set";

  const result = await generateFromReference({
    reference_type: "voice_note",
    reference_id: sp.note,
    hcp_job_id: id,
    target_scope: scope,
    extra_instructions: sp.extra,
    existing_option_summary: scope === "add_to_option" ? sp.option_summary : undefined,
  });

  if (!result.ok) {
    return (
      <PageShell
        kicker="New estimate · Based on a voice note"
        title="Generation failed"
        description={result.error}
      >
        <Link href={`/job/${id}/estimate/from-voice-note`} className="text-sm text-brand-700 hover:underline">
          ← Pick a different note
        </Link>
      </PageShell>
    );
  }

  const { options, note } = mapGeneratorToBuilder(result.output, scope);

  return (
    <PageShell
      kicker="New estimate · Based on a voice note"
      title="Review & push"
      description={`${customerName} · ${result.source_summary}. Edit anything below — the generator's a starting point.`}
    >
      <div className="mb-4 flex flex-wrap gap-3">
        <Link href={`/job/${id}/estimate/from-voice-note`} className="text-xs text-neutral-500 hover:underline">
          ← Pick a different note
        </Link>
        <Link href={`/job/${id}/estimate/new`} className="text-xs text-neutral-500 hover:underline">
          Or build from scratch
        </Link>
      </div>

      <EstimateBuilder
        hcpJobId={id}
        customerName={customerName}
        defaultProjectName={defaultProjectName}
        initialOptions={options}
        initialNote={note}
        basedOnBanner={{
          voiceNoteId: sp.note,
          sourceSummary: result.source_summary,
          model: result.model,
        }}
      />
    </PageShell>
  );
}
