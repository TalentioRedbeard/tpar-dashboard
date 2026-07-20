"use client";

// Settings form (2026-06-18). One Save for the personal-preference block (writes
// all whitelisted columns at once via updateMySettings); the owner-only globals
// are separate instant toggles. Feedback is inline (no toast lib in this app).

import { useState, useTransition } from "react";
import {
  updateMySettings, createAvatarUpload, setSmsMaster, setPhoneLoginEnabled,
  type MySettings, type DetailLevel, type JobBanner, type Accent, type LogoVariant, type LifecycleNudge,
} from "../lib/settings-actions";
import { browserClient } from "../lib/supabase-browser";

type Vehicle = { id: string; label: string; driver: string | null };

// Settings Wave choices
const BANNER_CHOICES: Array<[JobBanner, string, string]> = [
  ["customer", "Customer name", "Show who the job is for (today's default)."],
  ["address", "Job address", "Show where the job is; the customer name moves to the line below."],
];
const ACCENT_CHOICES: Array<{ value: Accent; label: string; swatch: string }> = [
  { value: "gold", label: "Gold", swatch: "#e8a200" },
  { value: "purple", label: "Purple", swatch: "#b48fd6" },
  { value: "teal", label: "Teal", swatch: "#6fbcae" },
];
const LOGO_CHOICES: Array<[LogoVariant, string]> = [
  ["default", "Default"], ["type", "Type"], ["outline", "Outline"], ["poster", "Poster"],
];
const NUDGE_CHOICES: Array<[LifecycleNudge, string]> = [
  ["off", "Off — no arrival nudge"],
  ["slack", "Slack (today's default)"],
  ["text", "Text me"],
  ["text_call", "Text, then call"],
];

// A control appears only once its consumer ships — flip a flag to true in the same
// commit that wires that feature. Persisting an unwired pref is harmless, but a
// control that visibly does nothing isn't. Banner + vehicle are live from Phase 1.
const WIRED = { nudges: false, bests: false, accent: false, icon: false };

// "How the app fits you" — personality levers (2026-07-05). These are honored,
// not decorative: detail level + processing notes steer the AI ask bar's answer
// style; simple mode reshapes /me; wrap reminder gates the end-of-day nudge.
const DETAIL_CHOICES: Array<{ value: DetailLevel; label: string; hint: string }> = [
  { value: "concise", label: "Concise", hint: "give me the short version" },
  { value: "standard", label: "Standard", hint: "the normal amount of detail" },
  { value: "walkthrough", label: "Walkthrough", hint: "step-by-step, don't skip" },
];

const LANDING_BASE: Array<[string, string]> = [
  ["", "Role default"],
  ["/me", "My day"],
  ["/schedule", "Schedule"],
  ["/jobs", "Jobs"],
  ["/customers", "Customers"],
  ["/comms", "Comms"],
  ["/gallery", "Gallery"],
  ["/shopping", "Shopping"],
];
const LANDING_LEADERSHIP: Array<[string, string]> = [["/dispatch", "Dispatch"], ["/reports", "Reports"]];

const inputCls = "w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

function Toggle({ checked, onChange, disabled, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; hint?: string;
}) {
  return (
    <label className="flex items-start gap-3 py-1.5">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 accent-brand-600"
      />
      <span>
        <span className="text-sm font-medium text-neutral-800">{label}</span>
        {hint ? <span className="block text-xs text-neutral-500">{hint}</span> : null}
      </span>
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-800">{title}</h3>
      <div className="divide-y divide-neutral-100">{children}</div>
    </div>
  );
}

export function SettingsForm({ initial, leadership, vehicles = [] }: { initial: MySettings; leadership: boolean; vehicles?: Vehicle[] }) {
  // Store user-facing positives; convert to *_opt_out on save. `baseline` is the
  // last-saved state — dirty compares against it, and a successful save advances it
  // (so the button disables and "Saved." shows without a prop round-trip).
  const [receiveTeamSms, setReceiveTeamSms] = useState(!initial.sms_opt_out);
  const [receiveEodDm, setReceiveEodDm] = useState(!initial.eod_dm_opt_out);
  const [receiveFeedbackDm, setReceiveFeedbackDm] = useState(!initial.feedback_dm_opt_out);
  const [showGps, setShowGps] = useState(!initial.gps_prompts_opt_out);
  const [showRecorder, setShowRecorder] = useState(!initial.hide_quick_recorder);
  const [color, setColor] = useState(initial.color_hex ?? "");
  const [landing, setLanding] = useState(initial.default_landing ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initial.avatar_url ?? "");
  const [detailLevel, setDetailLevel] = useState<DetailLevel>(initial.detail_level);
  const [simpleMode, setSimpleMode] = useState(initial.simple_mode);
  const [wrapReminder, setWrapReminder] = useState(initial.wrap_reminder);
  const [processingNotes, setProcessingNotes] = useState(initial.processing_notes);
  // Settings Wave
  const [jobBanner, setJobBanner] = useState<JobBanner>(initial.job_banner);
  const [accent, setAccent] = useState<Accent>(initial.accent);
  const [logoVariant, setLogoVariant] = useState<LogoVariant>(initial.logo_variant);
  const [showBests, setShowBests] = useState(initial.show_personal_bests);
  const [nudges, setNudges] = useState<LifecycleNudge>(initial.lifecycle_nudges);
  const [vehicleId, setVehicleId] = useState(initial.default_vehicle_id ?? "");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [baseline, setBaseline] = useState({
    receiveTeamSms: !initial.sms_opt_out,
    receiveEodDm: !initial.eod_dm_opt_out,
    receiveFeedbackDm: !initial.feedback_dm_opt_out,
    showGps: !initial.gps_prompts_opt_out,
    showRecorder: !initial.hide_quick_recorder,
    color: initial.color_hex ?? "",
    landing: initial.default_landing ?? "",
    avatarUrl: initial.avatar_url ?? "",
    detailLevel: initial.detail_level,
    simpleMode: initial.simple_mode,
    wrapReminder: initial.wrap_reminder,
    processingNotes: initial.processing_notes,
    jobBanner: initial.job_banner,
    accent: initial.accent,
    logoVariant: initial.logo_variant,
    showBests: initial.show_personal_bests,
    nudges: initial.lifecycle_nudges,
    vehicleId: initial.default_vehicle_id ?? "",
  });

  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty =
    receiveTeamSms !== baseline.receiveTeamSms ||
    receiveEodDm !== baseline.receiveEodDm ||
    receiveFeedbackDm !== baseline.receiveFeedbackDm ||
    showGps !== baseline.showGps ||
    showRecorder !== baseline.showRecorder ||
    color !== baseline.color ||
    landing !== baseline.landing ||
    avatarUrl !== baseline.avatarUrl ||
    detailLevel !== baseline.detailLevel ||
    simpleMode !== baseline.simpleMode ||
    wrapReminder !== baseline.wrapReminder ||
    processingNotes !== baseline.processingNotes ||
    jobBanner !== baseline.jobBanner ||
    accent !== baseline.accent ||
    logoVariant !== baseline.logoVariant ||
    showBests !== baseline.showBests ||
    nudges !== baseline.nudges ||
    vehicleId !== baseline.vehicleId;

  function save() {
    setErr(null);
    setSaved(false);
    start(async () => {
      const res = await updateMySettings({
        sms_opt_out: !receiveTeamSms,
        eod_dm_opt_out: !receiveEodDm,
        feedback_dm_opt_out: !receiveFeedbackDm,
        gps_prompts_opt_out: !showGps,
        hide_quick_recorder: !showRecorder,
        color_hex: color === "" ? null : color,
        default_landing: landing === "" ? null : landing,
        avatar_url: avatarUrl === "" ? null : avatarUrl,
        detail_level: detailLevel,
        simple_mode: simpleMode,
        wrap_reminder: wrapReminder,
        processing_notes: processingNotes,
        job_banner: jobBanner,
        accent,
        logo_variant: logoVariant,
        show_personal_bests: showBests,
        lifecycle_nudges: nudges,
        default_vehicle_id: vehicleId === "" ? null : vehicleId,
        allowed_vehicle_ids: vehicles.map((v) => v.id),
      });
      if (res.ok) {
        setBaseline({ receiveTeamSms, receiveEodDm, receiveFeedbackDm, showGps, showRecorder, color, landing, avatarUrl, detailLevel, simpleMode, wrapReminder, processingNotes, jobBanner, accent, logoVariant, showBests, nudges, vehicleId });
        setSaved(true);
      } else setErr(res.error);
    });
  }

  // Avatar: upload-first (browser → Storage direct), then the URL rides the
  // normal Save through the whitelist.
  async function pickAvatar(f: File | null) {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setErr("Avatar must be under 2MB."); return; }
    setErr(null);
    setAvatarBusy(true);
    try {
      const slot = await createAvatarUpload({ filename: f.name });
      if (!slot.ok) { setErr(slot.error); return; }
      const { error: upErr } = await browserClient().storage
        .from("avatars")
        .uploadToSignedUrl(slot.path, slot.token, f, { contentType: f.type || "image/jpeg" });
      if (upErr) { setErr(`Upload failed: ${upErr.message}`); return; }
      setAvatarUrl(slot.publicUrl);
    } finally {
      setAvatarBusy(false);
    }
  }

  const landingOpts = leadership ? [...LANDING_BASE, ...LANDING_LEADERSHIP] : LANDING_BASE;
  const hasColor = color !== "";

  return (
    <div className="space-y-4">
      {!initial.hasTech ? (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Your account isn&rsquo;t linked to a tech profile yet, so personal preferences can&rsquo;t be saved. Ask Danny to link you in the tech directory.
        </p>
      ) : initial.isImpersonating ? (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          You&rsquo;re in <strong>view-as</strong> mode. Exit view-as to change your own settings (this avoids editing the viewed tech&rsquo;s row by mistake).
        </p>
      ) : (
        <>
          <Group title="Notifications">
            <Toggle checked={receiveTeamSms} onChange={setReceiveTeamSms}
              label="Text me when a teammate sends me a note"
              hint="Texting is paused company-wide until carrier registration clears — this takes effect the day it's back on." />
            <Toggle checked={receiveEodDm} onChange={setReceiveEodDm}
              label="Send me the automated end-of-day Slack review"
              hint="The daily DM when one of your jobs ran long. Untick to mute it." />
          </Group>

          <Group title="Feedback & wraps">
            <Toggle checked={receiveFeedbackDm} onChange={setReceiveFeedbackDm}
              label="Slack me when my feedback gets answered"
              hint="Answers always land on your Home page either way — this is just the ping." />
            <Toggle checked={wrapReminder} onChange={setWrapReminder}
              label="Wrap reminder"
              hint="~6:30pm Slack nudge if you haven't recorded your Daily Wrap yet. Your call — nothing nags without this." />
            {initial.feedbackAnswered30d > 0 ? (
              <p className="py-1.5 text-xs text-neutral-500">
                Your feedback answered: <span className="font-semibold text-emerald-700">{initial.feedbackAnswered30d}</span> in the last 30 days —{" "}
                <a href="/me#heard" className="underline hover:text-neutral-700">see them on your Home page</a>.
              </p>
            ) : null}
          </Group>

          <Group title="Field & mobile">
            <Toggle checked={showGps} onChange={setShowGps}
              label="Show GPS arrival / finish prompts"
              hint="The one-tap “Start the job?” / “Finished here?” prompts on your day. Separate from your phone's location permission." />
            <Toggle checked={showRecorder} onChange={setShowRecorder}
              label="Show the quick-Record button"
              hint="The floating Record button in the top-right corner." />
            {WIRED.nudges ? (
            <div className="py-2">
              <label className="mb-1 block text-sm font-medium text-neutral-800">Arrival nudge when you reach a job</label>
              <select value={nudges} onChange={(e) => setNudges(e.target.value as LifecycleNudge)} className={inputCls}>
                {NUDGE_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <p className="mt-1 text-xs text-neutral-500">
                How the app pings you to Start a job when GPS says you&rsquo;ve arrived. Text and call nudges wait on carrier registration — they&rsquo;ll honor this the day texting is back.
              </p>
            </div>
            ) : null}
            <div className="py-2">
              <label className="mb-1 block text-sm font-medium text-neutral-800">Default vehicle for gas receipts</label>
              <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={inputCls}>
                <option value="">Automatic (your assigned van)</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}{v.driver ? ` · ${v.driver}` : ""}</option>)}
              </select>
              <p className="mt-1 text-xs text-neutral-500">Which vehicle a fuel receipt preselects. &ldquo;Automatic&rdquo; uses the van assigned to you.</p>
            </div>
          </Group>

          <Group title="How the app fits you">
            <div className="py-2">
              <span className="mb-1.5 block text-sm font-medium text-neutral-800">How much detail do you want?</span>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                {DETAIL_CHOICES.map((c) => (
                  <label
                    key={c.value}
                    className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 ${
                      detailLevel === c.value ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500" : "border-neutral-200 bg-white hover:border-neutral-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="detail_level"
                      value={c.value}
                      checked={detailLevel === c.value}
                      onChange={() => setDetailLevel(c.value)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                    />
                    <span>
                      <span className="block text-sm font-medium text-neutral-800">{c.label}</span>
                      <span className="block text-xs text-neutral-500">{c.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-neutral-500">The ask bar and AI answers follow this — it&rsquo;s honored, not a suggestion.</p>
            </div>
            <Toggle checked={simpleMode} onChange={setSimpleMode}
              label="Simple mode"
              hint="Calmer My Day — fewer panels, bigger buttons. On by default for field techs; your choice here sticks." />
            {WIRED.bests ? (
            <Toggle checked={showBests} onChange={setShowBests}
              label="Show my job times"
              hint="Adds a “Your times” card to My Day — your latest, average, and best onsite times. Only you see this; no leaderboard." />
            ) : null}
            <div className="py-2">
              <label className="mb-1 block text-sm font-medium text-neutral-800">How do you like information?</label>
              <textarea
                value={processingNotes}
                onChange={(e) => setProcessingNotes(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="In your own words — e.g. short lists first · walk me through steps · big picture before details"
                className={`${inputCls} resize-y`}
              />
              <p className="mt-1 text-xs text-neutral-500">Your own words go straight to the AI when it answers you.</p>
            </div>
          </Group>

          <Group title="Display">
            <p className="py-1.5 text-xs text-neutral-500">
              Signed in as <span className="font-medium text-neutral-700">{initial.techShortName ?? "—"}</span>
              {initial.dashboardRole ? <> · {initial.dashboardRole.replace("_", " ")}</> : null}
            </p>
            <div className="py-2">
              <label className="mb-1 block text-sm font-medium text-neutral-800">Avatar</label>
              <div className="flex items-center gap-3">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="your avatar" className="h-12 w-12 rounded-full border border-neutral-200 object-cover" />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-lg text-neutral-400">🙂</span>
                )}
                <input type="file" accept="image/*"
                  onChange={(e) => void pickAvatar(e.target.files?.[0] ?? null)}
                  className="block text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-200 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-800 hover:file:bg-neutral-300" />
                {avatarBusy ? <span className="text-xs text-brand-700">uploading…</span> : null}
                {avatarUrl ? (
                  <button type="button" onClick={() => setAvatarUrl("")} className="text-xs text-neutral-500 hover:underline">remove</button>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-neutral-500">Shows on the schedule, dispatch board, and map. Under 2MB; hit Save after picking.</p>
            </div>
            <div className="py-1.5">
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={hasColor}
                  onChange={(e) => setColor(e.target.checked ? (initial.color_hex || "#1e40af") : "")}
                  className="h-4 w-4 shrink-0 rounded border-neutral-300 accent-brand-600" />
                <span className="text-sm font-medium text-neutral-800">Use a custom schedule color</span>
              </label>
              {hasColor ? (
                <div className="mt-2 flex items-center gap-3 pl-7">
                  <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#1e40af"}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-8 w-12 cursor-pointer rounded border border-neutral-300" />
                  <span className="font-mono text-xs text-neutral-500">{color}</span>
                </div>
              ) : (
                <p className="mt-1 pl-7 text-xs text-neutral-500">Using your auto-assigned color on the schedule & dispatch board.</p>
              )}
            </div>
            <div className="py-2">
              <label className="mb-1 block text-sm font-medium text-neutral-800">Default page after login</label>
              <select value={landing} onChange={(e) => setLanding(e.target.value)} className={inputCls}>
                {landingOpts.map(([v, l]) => <option key={v || "default"} value={v}>{l}</option>)}
              </select>
              <p className="mt-1 text-xs text-neutral-500">Where you land when you open the app. “Role default” = your normal home.</p>
            </div>
            <div className="py-2">
              <span className="mb-1.5 block text-sm font-medium text-neutral-800">Job page banner</span>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {BANNER_CHOICES.map(([v, label, hint]) => (
                  <label key={v}
                    className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 ${jobBanner === v ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500" : "border-neutral-200 bg-white hover:border-neutral-300"}`}>
                    <input type="radio" name="job_banner" value={v} checked={jobBanner === v}
                      onChange={() => setJobBanner(v)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
                    <span>
                      <span className="block text-sm font-medium text-neutral-800">{label}</span>
                      <span className="block text-xs text-neutral-500">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {WIRED.accent ? (
            <div className="py-2">
              <span className="mb-1.5 block text-sm font-medium text-neutral-800">Accent color</span>
              <div className="flex flex-wrap gap-2">
                {ACCENT_CHOICES.map((a) => (
                  <button key={a.value} type="button" onClick={() => setAccent(a.value)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm ${accent === a.value ? "border-brand-500 ring-1 ring-brand-500" : "border-neutral-200 hover:border-neutral-300"}`}>
                    <span className="h-4 w-4 rounded-full border border-black/10" style={{ backgroundColor: a.swatch }} />
                    <span className="font-medium text-neutral-800">{a.label}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-neutral-500">Recolors the banner and gold accents across the app — for you only.</p>
            </div>
            ) : null}
            {WIRED.icon ? (
            <div className="py-2">
              <span className="mb-1.5 block text-sm font-medium text-neutral-800">App icon</span>
              <div className="flex flex-wrap gap-1.5">
                {LOGO_CHOICES.map(([v, label]) => (
                  <button key={v} type="button" onClick={() => setLogoVariant(v)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${logoVariant === v ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500 text-neutral-800" : "border-neutral-200 text-neutral-600 hover:border-neutral-300"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-neutral-500">Which mark shows in the top-left nav — a personal touch, professional either way.</p>
            </div>
            ) : null}
          </Group>

          <div className="flex items-center gap-3">
            <button type="button" onClick={save} disabled={pending || !dirty}
              className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300">
              {pending ? "Saving…" : "Save changes"}
            </button>
            {err ? <span className="text-sm text-red-700">{err}</span> : null}
            {saved && !err && !dirty ? <span className="text-sm text-emerald-700">Saved.</span> : null}
          </div>
        </>
      )}

      {/* Owner controls hide during view-as (hygiene, spec §1): previewing a
          tech must never render — let alone flip — the global switches. */}
      {initial.isOwner && !initial.isImpersonating ? <OwnerSection initialSms={initial.smsMaster} initialPhone={initial.phoneLogin} /> : null}
    </div>
  );
}

function OwnerSection({ initialSms, initialPhone }: { initialSms: boolean; initialPhone: boolean }) {
  const [sms, setSms] = useState(initialSms);
  const [phone, setPhone] = useState(initialPhone);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
      <h3 className="text-sm font-semibold text-brand-900">Owner controls <span className="font-normal text-brand-700/70">· only you see this</span></h3>
      <div className="mt-2 space-y-3">
        <SwitchRow
          label="Outbound SMS master switch"
          hint="Gates ALL outbound texts (teammate notes + customer texts). Ships OFF; flip on once you're ready to go live."
          on={sms}
          disabled={pending}
          onToggle={() => { const next = !sms; setSms(next); setErr(null); start(async () => { const r = await setSmsMaster(next); if (!r.ok) { setSms(!next); setErr(r.error); } }); }}
        />
        <SwitchRow
          label="Phone-OTP login"
          hint="Lets field techs sign in with a texted code. Keep OFF until the A2P 10DLC campaign is approved (a code can't deliver before then)."
          on={phone}
          disabled={pending}
          onToggle={() => { const next = !phone; setPhone(next); setErr(null); start(async () => { const r = await setPhoneLoginEnabled(next); if (!r.ok) { setPhone(!next); setErr(r.error); } }); }}
        />
        {err ? <p className="text-xs text-red-700">{err}</p> : null}
      </div>
    </div>
  );
}

function SwitchRow({ label, hint, on, disabled, onToggle }: {
  label: string; hint: string; on: boolean; disabled?: boolean; onToggle: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm font-medium text-neutral-800">{label}</div>
        <div className="text-xs text-neutral-500">{hint}</div>
      </div>
      <button type="button" onClick={onToggle} disabled={disabled}
        className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${on ? "bg-neutral-600 hover:bg-neutral-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
        {on ? "On · turn off" : "Off · turn on"}
      </button>
    </div>
  );
}
