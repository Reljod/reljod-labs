# Process transfer fixtures

Twelve sample Recordings for the Process transfer demo. Each is a mock video call of 70 to 120 seconds. On it a presenter shares their screen and hands a back-office process over to a colleague who is taking it on. The demo sends a Recording to a multimodal model, which turns it into a workflow document and a slide deck. These recordings are the inputs, and `expected/` is what a correct extraction should find.

Everything in them is fictional: Meridian Bank & Trust, the Republic of Meridia (currency M$), every person, employer, merchant, correspondent bank, account number and watchlist entry. The shared screen carries a SPECIMEN watermark and a "Synthetic demo data" footer. The call chrome is generic and copies no real meeting product.

| Slug | Process | App on screen |
| --- | --- | --- |
| `contribution-reconciliation` | Month-end pension contribution reconciliation | Pensions Desk |
| `dormant-account-reactivation` | Reactivating a dormant account | Branch Desk |
| `wire-recall` | Recalling an outgoing wire | PayOps |
| `employer-onboarding` | Onboarding a new employer to the pension plan | Employer Hub |
| `chargeback-dispute` | Handling a card chargeback dispute | CardCase |
| `nostro-break` | Investigating a nostro reconciliation break | Recon Station |
| `kyc-periodic-review` | KYC periodic review refresh | KYC Workbench |
| `returned-cheque` | Processing a returned cheque | Clearing Desk |
| `standing-order-change` | Amending a standing order under dual approval | PayOps Mandates |
| `sanctions-alert` | Dispositioning a sanctions screening alert | ScreenGuard |
| `fee-refund` | Approving a fee refund | Care Console |
| `user-access-request` | Provisioning core-banking user access | Access Hub |

## Layout

- `template/call.html`: one HyperFrames composition holding the whole call. It contains the call frame (title, REC dot and timer, two participant tiles with a level ring on whoever speaks, controls) and the app shell (top bar, sidebar, pages built from blocks: kpis, filters, table, form, detail, compare, docs, notes, checklist, meter, tabs, callout, buttons). It also has the overlays (menus, modals, toasts) and the cursor engine (eased moves, click ripples, typing with a caret). Every frame is a pure function of time. `renderAt(t)` replays the event list up to `t`, so HyperFrames can seek to any frame in any order.
- `recordings/<slug>.mjs`: one call each. It defines the people and their voices, the initial screen state (`ui.pages`), and the `lines` of dialogue in order. Each line has a speaker (`P` presenter, `R` receiver), the words, an optional `step` title, and an `act` list. Actions run while the line is spoken: `click`, `point`, `type`, `check`, `select`/`pick` (opens a menu, then chooses), `wait`, and state changes (`nav`, `set`, `add`, `modal`, `toast`, `loading`, `blur`). The next line waits until the actions finish, so speech never runs ahead of the screen. The file also lists the `decisions`, `warnings` and `openQuestions` that are spoken.
- `expected/<slug>.json`: the ground truth for scoring an extraction. It is written by the render script, so step times always match the render. Each step's `at` is the second its first action starts, or the line's start when the step has no action.
- `public/process-transfer/samples/<slug>.mp4` and `<slug>.jpg`: the outputs. Each video is 1280x720, H.264 yuv420p at 15 fps, with AAC mono at 48 kb/s and faststart, under 3.5 MB. Each poster is a 640x360 frame from mid-call, under 60 KB.

## How they are made, with only free and local tools

**The question:** can a Claude subscription alone make a video of someone sharing their screen and showing a process? It can, if the screen share is built rather than filmed. Claude writes the fake app and the call frame as HTML, scripts every click and line of dialogue as data, and three local tools turn that into a video:

1. **Voices: Kokoro-82M, local text-to-speech.** It runs through `npx hyperframes tts`. Each line is spoken by one of Kokoro's English voices, and each call pairs two clearly different voices (US and UK, male and female). Lines are cached by voice, speed and text.
2. **Timing and audio mix: the render script, in Node.** It trims each line, lays the actions out against the speech, mixes the dialogue with a faint room tone, and measures each speaker's level at 15 fps to drive the tiles.
3. **Video: HyperFrames.** `npx hyperframes render` seeks the composition frame by frame in headless Chrome and encodes it. HyperFrames is open source; nothing here uses its cloud.
4. **Mux: ffmpeg.** It joins video and dialogue, normalises loudness to -17 LUFS, and encodes to the size target. If the CRF pass is still over 3.5 MB, a two-pass bitrate encode is used instead.

**Why not record a real browser?** A Playwright screen recording of a scripted page also works. But it plays in real time, its frame timing drifts against separately made audio, and a fix means re-recording. A seekable HyperFrames composition is deterministic: the same script gives the same frames, re-renders take about a minute per call, and audio sync is exact because the actions are scheduled from the measured length of each spoken line.

**Checked with the real model.** `contribution-reconciliation`, `sanctions-alert`, `nostro-break` and `chargeback-dispute` were sent to `google/gemini-3.8-flash` through Vercel AI Gateway. Each time it named both speakers and their roles and listed the on-screen steps at the right times. It also restated the spoken decisions, the warning and the open item. The four checks cost about US$0.07 together.

### Limits

- The voices are synthetic. Kokoro is clear and fairly natural, but its prosody is even: no hesitations, crosstalk or "um"s. Fillers are written as words ("Okay, so", "Right").
- The participants have cameras off (initials avatars). A talking-head video would need a paid avatar service.
- The app is a mock built from a small set of blocks. It looks like a real internal tool but does nothing; every state change is scripted.
- Numbers are spelled out in speech (Kokoro reads long digit strings poorly), while the screen shows the figures.

## Re-rendering

One-time setup, outside the repo:

```bash
# Kokoro needs a Python with kokoro-onnx; HyperFrames runs it through HYPERFRAMES_PYTHON
uv venv --python 3.12 ~/.cache/process-transfer-tts
uv pip install --python ~/.cache/process-transfer-tts/bin/python kokoro-onnx soundfile
# HyperFrames refuses a group-writable cache dir, so give it a private one
mkdir -p ~/.local/share/hyperframes-cache && chmod 700 ~/.local/share/hyperframes-cache
HYPERFRAMES_CACHE_DIR=~/.local/share/hyperframes-cache npx hyperframes@0.9.61 browser ensure
```

The script uses those two paths by default. Set `HYPERFRAMES_PYTHON` or `HYPERFRAMES_CACHE_DIR` to override them. The Kokoro model (about 300 MB) downloads into the cache on first use. ffmpeg and ffprobe must be on `PATH`.

```bash
pnpm render:process-transfer-samples                          # all twelve, about a minute each
pnpm render:process-transfer-samples --only wire-recall       # one
pnpm render:process-transfer-samples --only wire-recall --keep-video  # reuse the last frames, redo audio/mux/expected
```

Intermediate files (TTS cache, per-call composition, silent render, mixed dialogue and `transcript.txt`) go to `node_modules/.cache/process-transfer/`, which is git-ignored. The script prints each call's duration and size. Copy those into `src/features/process-transfer/domain/samples.ts` when they change.

Before adding a recording, open a few frames (`ffmpeg -ss 40 -i out.mp4 -frames:v 1 f.png`). Long page titles, more than four action buttons, or wide tables next to another card will truncate or clip.

## Licences

- HyperFrames CLI (`hyperframes@0.9.61`): Apache-2.0, run through npx and not added to `package.json`. Rendering is local; its anonymous usage telemetry can be turned off with `npx hyperframes telemetry disable`.
- Kokoro-82M voice model and voices: Apache-2.0. `kokoro-onnx`: MIT.
- GSAP 3.14 (loaded from jsDelivr inside the composition): the standard GSAP licence, free to use.
- Inter and JetBrains Mono (Google Fonts): SIL Open Font License 1.1.
- ffmpeg: LGPL/GPL, used as a command-line tool.
