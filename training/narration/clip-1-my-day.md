<!-- DELIVERY: speed=1.1, stability=0.4, similarity=0.75 · punctuation: no em-dash chains, sentences <25 words, period = beat · target 150-165 wpm -->
# Clip 1 — "My Day: your home base" (~75 seconds)

Narration beats timed to `record-my-day.mjs`. Voice: warm, unhurried, plain-spoken —
a teammate showing you around, not a commercial. Generate each beat as its own MP3
via `synthesize-speech` (gated on ELEVENLABS_API_KEY), then assemble with ffmpeg.
v2c pacing pass (7/06 PM): punctuation-only rhythm normalization — ZERO word changes.

**Beat 1 (0:00–0:12) — the top**
> This is My Day. Your home base in the TPAR app. Everything you need for the day lives on this one page. Right up top: your clock button. Tap it when you start and when you stop. That's it.

**Beat 2 (0:12–0:28) — expectations + whiteboard**
> Below that, the day's expectations. What a good day looks like in your lane. And the whiteboard, where the team posts what everybody should see today.

**Beat 3 (0:28–0:45) — quick actions**
> These tiles are your quick actions. Snap a receipt the minute it's in your hand. Leave a voice note instead of typing. Find any job. And Ask. That's the smart search. Ask it anything about a job or a customer, in plain words.

**Beat 4 (0:45–0:58) — the Daily Wrap**
> This one matters: your Daily Wrap. Thirty seconds at the end of the day. How'd it go, what fought you, what should the app do better. You talk, it types. What you say here actually changes how we build things.

**Beat 5 (0:58–1:15) — appointments + close**
> And your appointments for today, right where you'd expect them. That's the tour. One page, everything in reach. Next clip: clocking in and out on a real job.

## Assembly (once narration MP3s exist)
```
ffmpeg -i my-day-<date>.webm -i beats-concat.mp3 -c:v libx264 -c:a aac -shortest my-day-final.mp4
```
Regenerate any time the UI changes: rerun the recorder, reuse the cached narration.
