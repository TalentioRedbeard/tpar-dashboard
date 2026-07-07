// The 7 TPAR onboarding clips, in play order — the data behind /training.
//
// The source MP4s live in C:\tpar-dashboard\training\videos\ (gitignored) and
// are HOSTED in the public Supabase Storage bucket `training-clips` — they are
// NOT in git. To update a chapter: re-render, then re-upload to the SAME object
// name (see training/videos + the one-time uploader). Bucket created + all 7
// uploaded/verified 2026-07-07.
//
// Public URL form: {SUPABASE_URL}/storage/v1/object/public/training-clips/<file>

export type TrainingClip = {
  /** 1-based chapter number (display + ordering). */
  n: number;
  /** stable id used for progress tracking + video keys. */
  slug: string;
  emoji: string;
  title: string;
  /** one-line "what you'll learn". */
  desc: string;
  /** human runtime, m:ss. */
  runtime: string;
  /** runtime in seconds (for totals / progress math). */
  runtimeSec: number;
  /** public storage URL of the final-cut mp4. */
  url: string;
};

const BUCKET_BASE =
  "https://bwpoqsfrygyopwxmegax.supabase.co/storage/v1/object/public/training-clips";

export const TRAINING_CLIPS: TrainingClip[] = [
  {
    n: 1,
    slug: "intro",
    emoji: "👋",
    title: "Welcome — the one-minute map",
    desc: "The whole app in a minute: what it does, why it's here, and how your day flows through it.",
    runtime: "3:36",
    runtimeSec: 216,
    url: `${BUCKET_BASE}/intro.mp4`,
  },
  {
    n: 2,
    slug: "my-day",
    emoji: "☀️",
    title: "My Day — your home base",
    desc: "The one screen you open every morning: your jobs, your clock, your numbers, all in order.",
    runtime: "1:42",
    runtimeSec: 102,
    url: `${BUCKET_BASE}/my-day.mp4`,
  },
  {
    n: 3,
    slug: "clocking-in",
    emoji: "⏱️",
    title: "Clocking in + your status bar",
    desc: "Clock in, and let the status bar keep the office, the schedule, and the customer in sync for you.",
    runtime: "1:11",
    runtimeSec: 71,
    url: `${BUCKET_BASE}/clocking-in.mp4`,
  },
  {
    n: 4,
    slug: "daily-wrap",
    emoji: "🌙",
    title: "Your Daily Wrap",
    desc: "End the day in half a minute — a quick spoken wrap so nothing important lives only in your head.",
    runtime: "0:57",
    runtimeSec: 57,
    url: `${BUCKET_BASE}/daily-wrap.mp4`,
  },
  {
    n: 5,
    slug: "estimate-piwm",
    emoji: "🏷️",
    title: "Building an estimate + Price it with me",
    desc: "Turn what you found into good / better / best options, and let “Price it with me” scope and price it.",
    runtime: "2:13",
    runtimeSec: 133,
    url: `${BUCKET_BASE}/estimate-piwm.mp4`,
  },
  {
    n: 6,
    slug: "ask-field-guide",
    emoji: "✨",
    title: "Ask + the Field Guide",
    desc: "Ask the app anything in plain English, and lean on the Field Guide when a job gets tricky.",
    runtime: "1:20",
    runtimeSec: 80,
    url: `${BUCKET_BASE}/ask-field-guide.mp4`,
  },
  {
    n: 7,
    slug: "receipts",
    emoji: "📷",
    title: "Receipts + photos",
    desc: "Snap receipts and job photos so costs land on the right job and your arrival shots protect you.",
    runtime: "1:01",
    runtimeSec: 61,
    url: `${BUCKET_BASE}/receipts.mp4`,
  },
];

/** Total runtime of the whole walkthrough, as "m:ss". */
export function totalRuntime(): string {
  const s = TRAINING_CLIPS.reduce((a, c) => a + c.runtimeSec, 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
