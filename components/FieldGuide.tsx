// FieldGuide — the Field Doctrine rendered VISUALLY for the crew (/how-to).
// Danny's brief: techs won't read a document — every tile "clearly framed and
// labeled for easy identification", pictures keep the mind on the subject,
// skimmable in seconds. So: big icons, bold one-line rules, and the longer
// detail hidden behind native <details> taps (no client JS, works everywhere).
//
// Three boards, in doctrine order:
//   1. The money ladder — vertical stepper, gold numbered badges 0-5 on a
//      connecting rail (the centerpiece).
//   2. How we carry ourselves — 10 principles as an icon-forward card grid.
//   3. When you're stuck — the 4-rung escalation ladder + the app-access
//      alert strip.
//
// Server component (no "use client") — data comes in as props from the page
// (lib/field-doctrine, service-role). check_pending → amber "$ finalized" chip.

import type { DoctrineRow } from "../lib/field-doctrine";

function PendingChip() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-accent-500/50 bg-accent-50 px-1.5 py-0.5 text-[10px] font-semibold text-accent-700">
      $ being finalized
    </span>
  );
}

function Chevron() {
  return (
    <span aria-hidden className="ml-auto shrink-0 self-center text-neutral-400 transition-transform group-open:rotate-180">
      ⌄
    </span>
  );
}

// Labeled frame shared by the three boards — the "clearly framed and labeled"
// requirement, applied uniformly so each board reads as one identifiable tile.
function GuideBoard({ kicker, title, blurb, children }: {
  kicker: string;
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border-2 border-brand-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-gold-600">{kicker}</div>
      <h2 className="mt-0.5 text-lg font-bold text-navy-900">{title}</h2>
      {blurb ? <p className="mt-1 text-sm leading-relaxed text-neutral-600">{blurb}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

// ── 1. The money ladder — vertical stepper (the centerpiece) ────────────────
function MoneyLadder({ steps }: { steps: DoctrineRow[] }) {
  return (
    <div className="relative">
      {/* The rail — runs behind the gold step badges (masked by their white ring). */}
      <div
        aria-hidden
        className="absolute bottom-6 left-[1.375rem] top-6 w-1 -translate-x-1/2 rounded-full bg-gradient-to-b from-gold-300 via-gold-500 to-gold-600"
      />
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.ord} className="relative flex items-start gap-3">
            {/* Numbered gold step badge on the rail */}
            <span
              aria-hidden
              className="z-10 mt-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold-500 text-lg font-extrabold text-navy-900 shadow ring-4 ring-white"
            >
              {s.ord}
            </span>
            <details className="group min-w-0 flex-1 rounded-2xl border-2 border-brand-200 bg-white shadow-sm transition open:border-brand-300">
              <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="text-3xl leading-none">{s.icon}</span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-base font-bold leading-snug text-neutral-900">
                    {s.title}
                    {s.check_pending ? <PendingChip /> : null}
                  </span>
                  <span className="mt-0.5 block text-sm leading-snug text-neutral-700">{s.rule}</span>
                </span>
                <Chevron />
              </summary>
              {s.detail ? (
                <div className="border-t border-neutral-100 px-4 pb-4 pt-3 text-sm leading-relaxed text-neutral-700">
                  {s.detail}
                </div>
              ) : null}
            </details>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── 2. How we carry ourselves — icon-forward principle card grid ────────────
function PrincipleGrid({ items }: { items: DoctrineRow[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
      {items.map((p) => (
        <details
          key={p.ord}
          className="group rounded-2xl border-2 border-brand-200 bg-white shadow-sm transition open:border-brand-300"
        >
          <summary className="flex h-full cursor-pointer list-none flex-col items-start gap-1.5 p-3 sm:p-4 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="text-4xl leading-none">{p.icon}</span>
            <span className="flex flex-wrap items-center gap-1.5 text-sm font-bold leading-snug text-neutral-900">
              {p.title}
              {p.check_pending ? <PendingChip /> : null}
            </span>
            <span className="text-xs leading-snug text-neutral-600">{p.rule}</span>
            <span className="text-[11px] font-semibold text-brand-700">
              <span className="group-open:hidden">{"more ⌄"}</span>
              <span className="hidden group-open:inline">{"less ⌃"}</span>
            </span>
          </summary>
          {p.detail ? (
            <div className="border-t border-neutral-100 px-3 pb-3 pt-2 text-xs leading-relaxed text-neutral-700 sm:px-4">
              {p.detail}
            </div>
          ) : null}
        </details>
      ))}
    </div>
  );
}

// ── 3. When you're stuck — the 4-rung escalation ladder ─────────────────────
function StuckLadder({ rungs }: { rungs: DoctrineRow[] }) {
  return (
    <div>
      <ol className="space-y-2">
        {rungs.map((r) => (
          <li key={r.ord}>
            <details className="group rounded-2xl border-2 border-brand-200 bg-white shadow-sm transition open:border-brand-300">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3 [&::-webkit-details-marker]:hidden">
                {/* Rung number — navy plate, gold numeral (ladder rung look) */}
                <span
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-navy-800 text-base font-extrabold text-gold-400 shadow"
                >
                  {r.ord}
                </span>
                <span aria-hidden className="text-2xl leading-none">{r.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-bold leading-snug text-neutral-900">
                    {r.title}
                    {r.check_pending ? <PendingChip /> : null}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-neutral-600">{r.rule}</span>
                </span>
                <Chevron />
              </summary>
              {r.detail ? (
                <div className="border-t border-neutral-100 px-4 pb-3 pt-2 text-sm leading-relaxed text-neutral-700">
                  {r.detail}
                </div>
              ) : null}
            </details>
          </li>
        ))}
      </ol>
      {/* The one thing that must never wait a rung — styled as an alert strip. */}
      <div className="mt-3 flex items-center gap-3 rounded-xl border-2 border-flagred-500/60 bg-red-50 px-4 py-3">
        <span aria-hidden className="text-2xl leading-none">🚨</span>
        <p className="text-sm font-semibold leading-snug text-flagred-700">
          App access broken? That&rsquo;s an emergency to <em>us</em> — <span className="underline underline-offset-2">text the office NOW</span>. A login should never decide how a job goes.
        </p>
      </div>
    </div>
  );
}

/** The full Field Doctrine block for /how-to. Renders nothing if the table is empty. */
export function FieldGuide({ rows }: { rows: DoctrineRow[] }) {
  const money = rows.filter((r) => r.section === "money_ladder");
  const principles = rows.filter((r) => r.section === "principle");
  const stuck = rows.filter((r) => r.section === "stuck_ladder");
  if (money.length + principles.length + stuck.length === 0) return null;

  return (
    <div id="doctrine" className="scroll-mt-24 space-y-4">
      {/* Doctrine masthead — navy band, gold kicker (the flag on the garage door). */}
      <section className="rounded-2xl border-2 border-navy-800 bg-navy-900 p-5">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold-400">Field doctrine</div>
        <h2 className="mt-1 text-xl font-bold text-white">How we run the work</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-brand-100">
          Three boards: how the money works, how we carry ourselves, and who to call when you&rsquo;re stuck. Tap any card for the longer version.
        </p>
      </section>

      {money.length > 0 ? (
        <GuideBoard
          kicker="Board 1 · The money ladder"
          title="How charging works — steps 0 to 5"
          blurb="Every job climbs the same ladder. Know which step you're on before you touch anything."
        >
          <MoneyLadder steps={money} />
        </GuideBoard>
      ) : null}

      {principles.length > 0 ? (
        <GuideBoard
          kicker="Board 2 · How we carry ourselves"
          title="The 10 principles"
          blurb="Skim the icons in 10 seconds; tap for the story behind each one."
        >
          <PrincipleGrid items={principles} />
        </GuideBoard>
      ) : null}

      {stuck.length > 0 ? (
        <GuideBoard
          kicker="Board 3 · When you're stuck"
          title="Four rungs — climb in order"
          blurb="Getting help fast is the system working, not you failing."
        >
          <StuckLadder rungs={stuck} />
        </GuideBoard>
      ) : null}
    </div>
  );
}
