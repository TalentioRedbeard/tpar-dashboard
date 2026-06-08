// /how-to — "How to use this app" guide. Opened in a new tab from the banner
// button (Danny 2026-06-05). Content ported from docs/FIELD_APP_CHEATSHEET.md
// (Danny's field-tested one-pager). Auth-gated like every other page (the Nav
// only renders for signed-in users; middleware gates the route).

import Link from "next/link";
import { PageShell } from "../../components/PageShell";

export const metadata = { title: "How to use the app · TPAR-DB" };
export const dynamic = "force-dynamic";

const STATUS_BUTTONS: Array<[string, string, string]> = [
  ["1", "Intake", "the lead / call / text comes in (office)"],
  ["2", "On My Way", "you leave for the job — texts the customer"],
  ["3", "Start", "you arrive and begin"],
  ["4", "Build Estimate", "you're pricing options"],
  ["5", "Present", "you've gone over it with the customer"],
  ["6", "Finish", "the work is done"],
  ["7", "Collect / Done", "payment + wrap-up"],
];

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{n}</span>
        <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      </div>
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-neutral-700">{children}</div>
    </section>
  );
}

export default function HowToPage() {
  return (
    <PageShell
      kicker="Field guide"
      title="How to use the app"
      description="One page. If it's good enough for Danny in the van, it's good enough for your day. The website does everything except take a customer's payment."
      backHref="/me"
      backLabel="Back to your day"
      hideAskBar
    >
      <div className="space-y-4">
        <Step n={1} title="Getting in">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Open the app link on your phone. Tap <strong>&ldquo;Continue with Google&rdquo;</strong> (your work Gmail), or enter your work email and tap <strong>&ldquo;Send magic link&rdquo;</strong>, then tap the link in your inbox in the same browser. You&rsquo;re in — no password.</li>
            <li><strong>Add it to your home screen</strong> so it opens like an app: Share → &ldquo;Add to Home Screen.&rdquo;</li>
            <li><strong>Allow Location when it asks.</strong> That&rsquo;s what powers the one-tap status prompts below — say yes once.</li>
          </ul>
        </Step>

        <Step n={2} title="Your day  (this page — My day)">
          <p>Everything for today lives here: your jobs, your clock, your trucks, your numbers, and the team whiteboard. Start here every morning.</p>
        </Step>

        <Step n={3} title="Clock in / out">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Tap <strong>&ldquo;Clock in&rdquo;</strong> on your day when you start, and <strong>&ldquo;Clock out&rdquo;</strong> when you&rsquo;re done. On a specific job, the button says <strong>&ldquo;Clock in here&rdquo;</strong>.</li>
            <li>If the app sees you&rsquo;re at a job site it&rsquo;ll <strong>offer to clock you in</strong> — just tap yes.</li>
          </ul>
        </Step>

        <Step n={4} title="The 7 status buttons  ← the big one">
          <p>On each job card, press the button as it happens. This is what makes dispatch, the customer texts, and your day&rsquo;s timeline real.</p>
          <div className="mt-2 overflow-hidden rounded-xl border border-neutral-200">
            <table className="w-full text-sm">
              <tbody>
                {STATUS_BUTTONS.map(([n, label, when], i) => (
                  <tr key={n} className={i % 2 ? "bg-neutral-50" : "bg-white"}>
                    <td className="w-8 px-3 py-2 text-center font-bold text-brand-700">{n}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-neutral-900">{label}</td>
                    <td className="px-3 py-2 text-neutral-600">{when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/50 p-3">
            <p><strong>You don&rsquo;t have to remember.</strong> When your GPS shows you pulled up to a job, the app pops a one-tap:</p>
            <p className="mt-1.5 italic text-neutral-600">📍 &ldquo;Looks like you&rsquo;re at [customer] — Start the job? <strong>Yes</strong> / Not yet&rdquo;</p>
            <p className="mt-1.5">Tap <strong>Yes</strong> and it presses Start for you (and updates Housecall Pro). When you leave a job you started, it asks <strong>&ldquo;Finished here?&rdquo;</strong> the same way. Tap <strong>Not yet</strong> if you&rsquo;re just grabbing parts or lunch. Every one is logged with your GPS — no paperwork.</p>
          </div>
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900">⚠️ Pressing <strong>On My Way</strong> with a job still open asks if you meant to <strong>Finish</strong> the last one first. Pick Finish, Pause, or Other.</p>
        </Step>

        <Step n={5} title="Line items & estimates">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Build the line items right on the job, then send a <strong>multi-option estimate</strong> (Good / Better / Best) for the customer to pick.</li>
            <li>The pricebook walks you through it (4 quick picks → the line).</li>
          </ul>
        </Step>

        <Step n={6} title="Customer & job insight">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Tap any <strong>job</strong> to see the full picture: history, notes, photos, the owner&rsquo;s briefing, prior work, money.</li>
            <li>Use <strong>Ask</strong> to ask the system in plain English (&ldquo;what did we do here last time?&rdquo;, &ldquo;what&rsquo;s this customer&rsquo;s history?&rdquo;).</li>
          </ul>
        </Step>

        <Step n={7} title="Comms & the whiteboard">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Your calls / texts / emails for your jobs show up right on your day under <strong>&ldquo;My recent comms&rdquo;</strong> — scan it in the morning so nothing falls through.</li>
            <li>The <strong>Team whiteboard</strong> on your day is where the company posts heads-ups, wins, and questions. Read it in the morning; post anything the team should see.</li>
          </ul>
        </Step>

        <section className="rounded-2xl border border-brand-300 bg-brand-50 p-5">
          <h2 className="text-base font-semibold text-brand-900">The deal</h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-700">
            Press your status buttons (or tap the GPS prompts) and clock in / out. That&rsquo;s 90% of it. Do that and the office, the schedule board, and the customer all stay in sync without anybody chasing you. Questions → ask Danny or Madisson.
          </p>
          <Link href="/me" className="mt-3 inline-flex items-center rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">
            ← Back to your day
          </Link>
        </section>
      </div>
    </PageShell>
  );
}
