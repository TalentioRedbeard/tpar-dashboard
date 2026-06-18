// /how-to — "How to use this app" guide. Opened in a new tab from the banner
// button (Danny 2026-06-05). Originally ported from docs/FIELD_APP_CHEATSHEET.md;
// expanded 2026-06-17 from the rollout-demo outline (docs/ROLLOUT_DEMO_2026-06-18.md
// §3) with the three new sections (clocking+money-live-in-HCP, the three team-comms
// avenues, errors-are-flags) and INLINE-RENDERED visual aids (no image assets —
// SVG/CSS so they're crisp, responsive, theme-matched, and stay accurate as the UI
// shifts). Depth lives in collapsible <details> so a tech in the van can skim it in
// under two minutes. Auth-gated like every page.

import Link from "next/link";
import { PageShell } from "../../components/PageShell";
import { getCurrentTech } from "../../lib/current-tech";

export const metadata = { title: "How to use the app · TPAR-DB" };
export const dynamic = "force-dynamic";

// The 4 buttons a tech actually presses (the heartbeat).
const TRIGGERS: Array<[string, string]> = [
  ["On My Way", "you leave for the job"],
  ["Start", "you arrive and begin"],
  ["Present", "you've gone over the options"],
  ["Finish", "the work is done"],
];

// The full Housecall Pro job lifecycle (the office handles the bookends).
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

// A "more detail" collapsible — keeps the page skimmable while holding depth.
function More({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3 text-sm leading-relaxed text-neutral-700">
      <summary className="cursor-pointer font-semibold text-neutral-800">{summary}</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

// ── Visual aids (inline-rendered; no image assets) ──────────────────────────

// The four-button "heartbeat" strip + what every press does.
function HeartbeatStrip() {
  return (
    <div className="mt-3 rounded-xl border border-brand-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        {TRIGGERS.map(([label, when], i) => (
          <div key={label} className="flex items-center gap-2">
            <div className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-center">
              <div className="text-sm font-bold text-brand-800">{label}</div>
              <div className="text-[11px] text-neutral-500">{when}</div>
            </div>
            {i < TRIGGERS.length - 1 ? <span className="text-lg text-brand-300">{"→"}</span> : null}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-neutral-500">{"each press → texts the customer · syncs Housecall Pro · builds your day’s timeline"}</p>
    </div>
  );
}

// Getting-in: three illustrated steps (no real screenshots needed).
function GettingInSteps() {
  const items: Array<[string, string, string]> = [
    ["G", "Continue with Google", "your work Gmail"],
    ["✉️", "Magic link", "or a one-time email link"],
    ["➕", "Add to Home Screen", "opens like a real app"],
  ];
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {items.map(([icon, label, sub]) => (
        <div key={label} className="rounded-xl border border-neutral-200 bg-white p-3 text-center">
          <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-base font-bold text-brand-700">{icon}</div>
          <div className="mt-2 text-xs font-semibold text-neutral-800">{label}</div>
          <div className="text-[11px] text-neutral-500">{sub}</div>
        </div>
      ))}
    </div>
  );
}

// A stylized "My day" mock with the blocks labeled (illustrative, not a screenshot).
function MeTourMock() {
  const blocks: Array<[string, string]> = [
    ["⏱️  Clock", "clock in / out for the day"],
    ["🗓️  Today's jobs", "your stops, in order"],
    ["📋  Team whiteboard", "company heads-ups"],
    ["🚐  Your truck", "the vehicle you're on"],
    ["📈  Your numbers", "a quick snapshot"],
    ["💬  Recent comms", "calls / texts / emails"],
  ];
  return (
    <div className="mt-3 flex justify-center">
      <div className="w-full max-w-[16rem] rounded-[1.75rem] border-4 border-neutral-800 bg-neutral-100 p-2">
        <div className="space-y-1.5 rounded-[1.25rem] bg-white p-2">
          <div className="text-center text-[11px] font-semibold text-neutral-400">My day</div>
          {blocks.map(([t, s]) => (
            <div key={t} className="rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5">
              <div className="text-xs font-semibold text-neutral-800">{t}</div>
              <div className="text-[10px] text-neutral-500">{s}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// SVG: what one trigger press fans out to.
function TriggerFlow() {
  const branches = [
    { y: 14, fill: "#ecfeff", stroke: "#06b6d4", text: "#155e75", label: "📱  Customer heads-up" },
    { y: 58, fill: "#f0fdf4", stroke: "#22c55e", text: "#166534", label: "🔄  Housecall Pro status" },
    { y: 102, fill: "#fffbeb", stroke: "#f59e0b", text: "#92400e", label: "📋  Your day's timeline" },
  ];
  return (
    <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-4">
      <svg viewBox="0 0 360 144" className="w-full" role="img" aria-label="What one trigger press fans out to">
        <rect x="14" y="55" width="124" height="34" rx="8" fill="#eef2ff" stroke="#6366f1" />
        <text x="76" y="76" textAnchor="middle" fontSize="12" fontWeight="700" fill="#3730a3">{"Press “Start”"}</text>
        {branches.map((b, i) => (
          <g key={i}>
            <line x1="138" y1="72" x2="208" y2={b.y + 14} stroke={b.stroke} strokeWidth="2" />
            <rect x="208" y={b.y} width="140" height="28" rx="7" fill={b.fill} stroke={b.stroke} />
            <text x="278" y={b.y + 18} textAnchor="middle" fontSize="10.5" fill={b.text}>{b.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// A stylized job-page mock with regions labeled (illustrative).
function JobPageMock() {
  const rows: Array<[string, string]> = [
    ["▸  Trigger bar", "On My Way · Start · Present · Finish"],
    ["📍  Address + directions", "tap to navigate"],
    ["📷  Photos", "arrival condition = your protection"],
    ["📝  Notes / 🎤 Voice", "put it on the record"],
    ["💬  Comms · ✨ Ask", "history + plain-English answers"],
  ];
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-neutral-300 bg-white">
      <div className="bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">Job · the 360</div>
      {rows.map(([t, s], i) => (
        <div key={t} className={`flex items-center justify-between gap-2 px-3 py-2 ${i % 2 ? "bg-neutral-50" : "bg-white"}`}>
          <span className="text-xs font-semibold text-neutral-800">{t}</span>
          <span className="text-[11px] text-neutral-500">{s}</span>
        </div>
      ))}
    </div>
  );
}

// Three avenue tiles at a glance.
function AvenueIcons() {
  const a: Array<[string, string, string]> = [
    ["📋", "Whiteboard", "everybody"],
    ["✉️", "Inbox", "one teammate"],
    ["📨", "To Danny", "leadership"],
  ];
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {a.map(([icon, label, sub]) => (
        <div key={label} className="rounded-xl border border-neutral-200 bg-white p-3 text-center">
          <div className="text-xl">{icon}</div>
          <div className="mt-1 text-xs font-semibold text-neutral-800">{label}</div>
          <div className="text-[11px] text-neutral-500">{sub}</div>
        </div>
      ))}
    </div>
  );
}

export default async function HowToPage() {
  // Role-aware: the leadership money/cost cluster only renders for admin + manager.
  const me = await getCurrentTech().catch(() => null);
  const leadership = !!(me && (me.isAdmin || me.isManager));
  return (
    <PageShell
      kicker="Field guide"
      title="How to use the app"
      description="One page. If it's good enough for Danny in the van, it's good enough for your day. Skim it in two minutes; tap “more detail” where you want it."
      backHref="/me"
      backLabel="Back to your day"
      hideAskBar
    >
      <div className="space-y-4">
        {/* ── The 30-second version ── */}
        <section className="rounded-2xl border border-brand-300 bg-brand-50 p-5">
          <h2 className="text-base font-semibold text-brand-900">The 30-second version</h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-700">
            Press your <strong>four buttons</strong> as the day happens, and <strong>clock in / out in Housecall Pro</strong>. That&rsquo;s 90% of it — do that and the office, the schedule, and the customer all stay in sync without anybody chasing you.
          </p>
          <HeartbeatStrip />
        </section>

        <Step n={1} title="Getting in">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Open the app link on your phone. Tap <strong>&ldquo;Continue with Google&rdquo;</strong> (your work Gmail), or enter your work email and tap <strong>&ldquo;Send magic link&rdquo;</strong>, then tap the link in your inbox <strong>in the same browser</strong>. You&rsquo;re in — no password.</li>
            <li><strong>Add it to your home screen</strong> so it opens like an app: Share → &ldquo;Add to Home Screen.&rdquo;</li>
            <li><strong>Allow Location when it asks.</strong> That&rsquo;s what powers the one-tap status prompts below — say yes once.</li>
          </ul>
          <GettingInSteps />
        </Step>

        <Step n={2} title="Your day  (the My-day page)">
          <p>Everything for today lives here — start here every morning. Each block:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li><strong>Clock</strong> — clock in/out for the day (more on where time really lives below).</li>
            <li><strong>Today&rsquo;s jobs</strong> — your stops, in order; tap one to open it.</li>
            <li><strong>Team whiteboard</strong> — the company&rsquo;s heads-ups, wins, and questions.</li>
            <li><strong>Your truck</strong> — the vehicle you&rsquo;re on.</li>
            <li><strong>Your numbers</strong> — a quick snapshot.</li>
            <li><strong>Recent comms</strong> — calls / texts / emails on your jobs, so nothing slips.</li>
          </ul>
          <MeTourMock />
        </Step>

        <Step n={3} title="The four buttons  ← the big one">
          <p>On each job, press the button as it happens. This is the heartbeat — it&rsquo;s what makes dispatch, the customer&rsquo;s heads-up texts, and your day&rsquo;s timeline real, with <strong>no paperwork</strong>.</p>
          <div className="mt-2 overflow-hidden rounded-xl border border-neutral-200">
            <table className="w-full text-sm">
              <tbody>
                {TRIGGERS.map(([label, when], i) => (
                  <tr key={label} className={i % 2 ? "bg-neutral-50" : "bg-white"}>
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
            <p className="mt-1.5">Tap <strong>Yes</strong> and it presses Start for you (and updates Housecall Pro). When you leave a job you started, it asks <strong>&ldquo;Finished here?&rdquo;</strong> the same way. Tap <strong>Not yet</strong> if you&rsquo;re just grabbing parts or lunch. Every one is logged with your GPS.</p>
          </div>
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900">⚠️ Pressing <strong>On My Way</strong> with a job still open asks if you meant to <strong>Finish</strong> the last one first. Pick Finish, Pause, or Other.</p>
          <p className="mt-2 text-xs text-neutral-500">Some steps fill themselves in: if a job gets worked in Housecall Pro, the app reads the real times and marks On My Way / Start / Finish for you (tagged &ldquo;from HCP&rdquo;) — so a step can show as done even when nobody pressed a button here.</p>

          <TriggerFlow />

          <More summary="What actually happens when I press one?">
            <ul className="list-disc space-y-1.5 pl-5">
              <li><strong>On My Way</strong> → texts the customer you&rsquo;re en route, flips the job&rsquo;s status in Housecall Pro.</li>
              <li><strong>Start</strong> → marks you on-site (GPS-stamped), status syncs to Housecall Pro.</li>
              <li><strong>Present</strong> → records that you&rsquo;ve walked the customer through the options.</li>
              <li><strong>Finish</strong> → closes out the on-site work and updates the status.</li>
            </ul>
            <p>The button keeps the <em>status</em> honest everywhere at once — you press it once, everybody sees it.</p>
          </More>
          <More summary="The full status list (the office handles the ends)">
            <div className="overflow-hidden rounded-xl border border-neutral-200">
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
            <p><strong>Intake</strong> and <strong>Collect / Done</strong> are mostly the office and wrap-up; your four are the ones in the middle.</p>
          </More>
        </Step>

        <Step n={4} title="Clocking & money — where they actually live">
          <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-3">
            <p className="font-semibold text-amber-900">Read this once and the rest of the app makes sense:</p>
            <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
              <li><strong>Your time is clocked in Housecall Pro.</strong> That&rsquo;s the official timecard — same as always.</li>
              <li><strong>Money is taken in Housecall Pro.</strong> Payment, invoices — all still HCP.</li>
              <li><strong>The app keeps the <em>status</em> in sync</strong> — where the job is, who&rsquo;s where, what&rsquo;s next.</li>
            </ul>
          </div>
          <p className="mt-2">The app&rsquo;s &ldquo;Clock in&rdquo; is a convenience that mirrors into Housecall Pro — but if you&rsquo;re ever unsure, <strong>Housecall Pro is the source of truth for time and money.</strong> The app isn&rsquo;t replacing it; it&rsquo;s keeping everyone on the same page about <em>where the work is.</em></p>
        </Step>

        <Step n={5} title="On a job — notes, photos, line items, Ask">
          <ul className="list-disc space-y-1.5 pl-5">
            <li><strong>Tap any job</strong> for the whole picture: the address with directions, history, prior work, the owner&rsquo;s briefing, notes, photos, money.</li>
            <li><strong>Photos protect you.</strong> Snap the arrival condition and anything already worn or damaged — that picture is your defense if a dispute ever comes up (see the &ldquo;old system&rdquo; note below).</li>
            <li><strong>Notes &amp; voice notes</strong> — drop a quick note (or talk it out) on the job so it&rsquo;s on the record, not in your head.</li>
            <li><strong>Line items &amp; estimates</strong> — line items live on the job; estimates go through Housecall Pro today. (Coming soon: the app helping you build <strong>good / better / best</strong> options to present — see the bottom.)</li>
            <li><strong>Ask</strong> — ask the system in plain English: &ldquo;what did we do here last time?&rdquo;, &ldquo;what&rsquo;s this customer&rsquo;s history?&rdquo;</li>
          </ul>
          <JobPageMock />
        </Step>

        <Step n={6} title="Talking to the team — three ways">
          <p>Three separate lanes, on purpose — pick the one that fits:</p>
          <AvenueIcons />
          <ul className="space-y-2">
            <li className="rounded-xl border border-neutral-200 bg-white p-3">
              <strong>📋 Team whiteboard</strong> — for everybody. Heads-ups, wins, questions the whole crew should see. Read it in the morning; post what the team should know.
            </li>
            <li className="rounded-xl border border-neutral-200 bg-white p-3">
              <strong>✉️ Inbox (a teammate)</strong> — a direct note to one specific person. Quick, private, between the two of you.
            </li>
            <li className="rounded-xl border border-neutral-200 bg-white p-3">
              <strong>📨 A straight line to Danny / leadership</strong> — for anything you want in front of the boss. And if you ever get a task you can&rsquo;t do, declining it pings Danny automatically — that&rsquo;s a flag, not a failure.
            </li>
          </ul>
        </Step>

        <Step n={7} title="Finding things — search that understands your customers">
          <p>Search now thinks in <strong>whole customers and whole projects</strong>, not just text matches.</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li><strong>Customers</strong> — searching a name pulls together every record for that customer that Housecall Pro split apart (same company, phone, or email), so one person or property shows as <em>one</em> result with their full history.</li>
            <li><strong>Jobs</strong> — results group into <strong>projects</strong>: a job, its follow-on invoices, and the estimate collapse into one line. Want the old job-by-job list? Add <span className="font-mono">?detail=1</span> to the page.</li>
            <li><strong>Photos</strong> — a customer&rsquo;s gallery spans all of their tethered records, so nothing hides under a duplicate.</li>
          </ul>
          <More summary="Why a customer shows “25 records”">
            <p>Big customers — a property manager, a builder — get entered into Housecall Pro many times over the years. The app stitches those back together so you see the real relationship (all the jobs, all the photos) in one place, instead of one slice of it.</p>
          </More>
        </Step>

        <Step n={8} title="Photos & the gallery">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Open <strong>Gallery</strong> from the top menu, or tap <strong>Photos</strong> on any job or customer.</li>
            <li>It now holds the <strong>full history</strong> — every photo and video from Housecall Pro, plus anything added in the app or Drive (about 19,700 in all).</li>
            <li><strong>What you can see:</strong> on the road you see photos for the jobs you worked; the office sees a customer&rsquo;s entire photo history.</li>
          </ul>
          <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-brand-900">Same lesson as before: <strong>photos protect you.</strong> The arrival-condition shot you take today is the gallery record that settles a dispute later.</p>
        </Step>

        <Step n={9} title="Settings — make the app yours">
          <p>Tap <strong>your name in the top-right</strong> (or <strong>Settings</strong> in the menu). Everything there changes the app for <em>you only</em>:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li><strong>Notifications</strong> — turn the teammate-note text on or off, and mute the automated end-of-day Slack review.</li>
            <li><strong>Field</strong> — turn the GPS arrival/finish prompts on or off, and show or hide the floating Record button.</li>
            <li><strong>Display</strong> — pick your color on the schedule board, and choose which page you land on when you open the app.</li>
          </ul>
          <p className="mt-2 text-xs text-neutral-500">Your sign-in, your name, and your role aren&rsquo;t editable here — those stay with Danny.</p>
        </Step>

        {leadership ? (
          <section className="rounded-2xl border border-indigo-300 bg-indigo-50/60 p-5">
            <h2 className="text-base font-semibold text-indigo-900">For managers &amp; owner — money &amp; cost</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-700">These surfaces are leadership-only (the crew never sees them):</p>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-neutral-700">
              <li className="rounded-xl border border-indigo-200 bg-white p-3">
                <strong>Cost-to-date on a job</strong> — open any job for a live running cost (materials from Housecall Pro + reconciled receipts, GPS-derived labor at a burden rate, and on-site materials) against the estimate, with margin and an over-budget warning. Tap <strong>Refresh from HCP</strong> to pull the latest line items.
              </li>
              <li className="rounded-xl border border-indigo-200 bg-white p-3">
                <strong>Reports → Receipt reconciliation</strong> — attach each unattributed receipt to a job (so its cost lands in that job&rsquo;s margin) or mark it overhead. It auto-suggests a job by who submitted it and when; bulk &ldquo;mark overhead&rdquo; clears the noise. The new <strong>View receipt</strong> button pops the receipt into its own window — read the PO/memo to decide where it belongs.
              </li>
              <li className="rounded-xl border border-indigo-200 bg-white p-3">
                <strong>Shopping → price intel + the market</strong> — see what we&rsquo;ve actually paid per part at each supplier. The cross-vendor comparison becomes trustworthy as you work the <strong>Reconcile</strong> queue: confirm each vendor line&rsquo;s match to our in-house catalog, and confirming teaches it for next time.
              </li>
              <li className="rounded-xl border border-indigo-200 bg-white p-3">
                <strong>Reports</strong> — managers now reach the whole Reports tree (margin, AR, spend), same as the owner.
              </li>
            </ul>
          </section>
        ) : null}

        {/* ── Kept verbatim: the protective old-system disclosure ── */}
        <section className="rounded-2xl border border-amber-300 bg-amber-50/60 p-5">
          <h2 className="text-base font-semibold text-amber-900">Before you work on an old system</h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-700">
            Most damage disputes start the same way: you work on an older system, something nearby fails, and the customer blames the repair. A fair share of that risk belongs to the <strong>old system</strong> — not you — but you have to set that up front, or it becomes a fight you can&rsquo;t win after the fact.
          </p>
          <p className="mt-3 text-sm font-semibold text-neutral-900">Three moves, every time, before you start:</p>
          <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-neutral-700">
            <li><strong>Say it up front.</strong> &ldquo;Here&rsquo;s the condition of what we&rsquo;re working on — repairs on an older system carry some inherent risk that&rsquo;s the system&rsquo;s, not ours.&rdquo; Set the expectation before you touch it.</li>
            <li><strong>Photo the arrival condition.</strong> Snap the area and anything already worn, cracked, or corroded, and drop it on the job (tap the job → photos). That picture is your protection.</li>
            <li><strong>Tell them what you find as you go.</strong> A surprise at the end becomes a dispute; a heads-up becomes trust.</li>
          </ol>
          <p className="mt-3 text-sm leading-relaxed text-neutral-700">
            This isn&rsquo;t about dodging responsibility — when it&rsquo;s genuinely on us, we make it right, no charge. It&rsquo;s about not eating fault that belongs to a decades-old system, and heading off the dispute before it ever starts.
          </p>
        </section>

        {/* ── NEW: errors-are-flags (the founding-vision principle, for the crew) ── */}
        <section className="rounded-2xl border border-emerald-300 bg-emerald-50/60 p-5">
          <h2 className="text-base font-semibold text-emerald-900">When something breaks — or just feels dumb</h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-700">
            This app isn&rsquo;t finished, and that&rsquo;s on purpose. If a button is broken, a screen is confusing, or something is just a pain in the butt — <strong>that&rsquo;s the most useful thing you can tell us.</strong> It&rsquo;s a <strong>flag, not a failure</strong>.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-neutral-700">
            Flag it (note to Danny, the whiteboard, or just tell somebody) → we look at it → it becomes a fix. That&rsquo;s how the app <em>and</em> the company get better, and it can come from <strong>any seat</strong> — you don&rsquo;t need a title to make this thing better. It&rsquo;s invited, not graded.
          </p>
        </section>

        {/* ── Kept: the closer ── */}
        <section className="rounded-2xl border border-brand-300 bg-brand-50 p-5">
          <h2 className="text-base font-semibold text-brand-900">The deal</h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-700">
            Press your four buttons (or tap the GPS prompts) and clock in / out in Housecall Pro. That&rsquo;s 90% of it. Do that and the office, the schedule board, and the customer all stay in sync without anybody chasing you. Use what helps you, flag what doesn&rsquo;t. Questions → ask Danny or Madisson.
          </p>
          <Link href="/me" className="mt-3 inline-flex items-center rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">
            ← Back to your day
          </Link>
        </section>
      </div>
    </PageShell>
  );
}
