# 0036. Floorwalk: the model watches the whole video, code decides what counts

Date: 2026-11-21

## Context

Gemini 4 Neon (on AI Gateway from 18 November 2026) takes video natively with a 1M-token context. A site walk is the business case where watching video beats reading text: a warehouse or shop manager walks the floor before opening, and what matters is seen, not written. We wanted a demo that shows the model finding problems in footage as it happens, while keeping the rule of the other demos: a model may report, only code and Rules decide.

## Decision

- **One call over the whole Footage.** No frame sampling or captions on our side. The Walker gets the video and the Standard, and writes NDJSON Lines as it goes. The route parses each complete Line as it arrives and streams the verdict, so Findings appear while the model is still writing.
- **The model cites; code checks.** A Sighting must cite a Rule id of the Standard, a second inside the Footage, a box of a minimum size and a minimum confidence (`checkSighting`). Repeats are merged. A Sighting with no Rule is Noticed, never scored.
- **The Standard decides.** Severity, weight and deadline come from `domain/rules.ts` and the visitor's edits. `scoreWalk` reads only Findings and the Standard, so changing a Rule re-scores the Walk with no model call.
- **Samples come with an answer key.** The Sample Footage is rendered from the same Site data the page draws the Floor plan from (Three.js in headless Chromium, deterministic). The render records where every planted problem and decoy is on screen, frame by frame, and `measureWalk` scores a Walk against it. The recorded Walks are shown with their misses (the grocer's missing price labels).
- **Replays are free and real.** Each Sample has a Recording of a real Walk with its timings; the page plays it without a call. "Walk it live" calls the model.
- **No saved data.** Only rate hits are stored. Uploads go to a private bucket under `uploads/<UTC hour>/<owner>/`, are checked again (owner, type, size, length) before the call, and hour folders older than six hours are swept after the next visit, Walk, Ask or upload (there is no cron, so an idle demo keeps the last uploads until someone comes back).

## Why not generated video

We tried text-to-video (Veo 3.1 Fast) for the Samples. It needs a $10 gateway balance, and its output cannot carry an answer key: we could not say where a planted problem is, or prove a decoy is one. Rendering the Footage from data gives exact ground truth and re-renders the same every time.

## Consequences

- The Walker's timestamps are whole seconds, so the answer key allows 1.5 s of slack around the time a problem is in view.
- Box positions are the model's; they are drawn as reported and checked only for shape, not against the answer key.
- A Walk costs about 3.5 cents and 15 to 20 seconds for 35 seconds of Footage.
