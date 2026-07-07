// Merge each clip's narration (the "> " quoted beat lines in its md, in
// order) into beats-text.json, preserving entries for clips not listed here.
// Run from training/: node narration/build-beats-text.mjs
import fs from "node:fs";

const FILES = {
  "clip-0-intro": "narration/clip-0-intro.md", // v2 (2026-07-06): Danny's edited 10-beat script
  "clip-1-my-day": "narration/clip-1-my-day.md", // v3 (7/07): Danny's notes — SIX beats (Coaching close + Message-the-office b4)
  "clip-2-clock-status": "narration/clip-2-clock-status.md",
  "clip-3-daily-wrap": "narration/clip-3-daily-wrap.md",
  "clip-4-estimate-piwm": "narration/clip-4-estimate-piwm.md",
  "clip-5-ask-field-guide": "narration/clip-5-ask-field-guide.md",
  "clip-6-receipts-photos": "narration/clip-6-receipts-photos.md",
};
const EXPECT = {
  "clip-0-intro": 10,
  "clip-1-my-day": 6,
  "clip-2-clock-status": 4,
  "clip-3-daily-wrap": 3,
  "clip-4-estimate-piwm": 6,
  "clip-5-ask-field-guide": 4,
  "clip-6-receipts-photos": 3,
};

const out = JSON.parse(fs.readFileSync("narration/beats-text.json", "utf8"));
for (const [key, file] of Object.entries(FILES)) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/)
    .filter((l) => l.startsWith("> "))
    .map((l) => l.slice(2).trim());
  if (lines.length !== EXPECT[key]) {
    throw new Error(`${key}: expected ${EXPECT[key]} beats, found ${lines.length}`);
  }
  out[key] = Object.fromEntries(lines.map((t, i) => [`b${i + 1}`, t]));
}
fs.writeFileSync("narration/beats-text.json", JSON.stringify(out, null, 2) + "\n");
console.log("beats-text.json updated:", Object.keys(out).join(", "));
