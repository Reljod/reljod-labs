# Switchboard fixtures

Everything here is synthetic: the Republic of Meridia, Meridia Rail and every caller are fictional. SPECIMEN.

- `samples.json`: the manifest of the Sample callers' clips (one per scripted line), with the text each clip was made from and what a transcription model heard back, as a round-trip check.
- The clips themselves are in `public/switchboard/samples/<caller>/<n>.mp3` (24 kHz mono), made by a speech model through Vercel AI Gateway. The callers and their lines are data in `src/features/switchboard/domain/samples.ts`.

Rebuild after changing a line (spends a few cents, needs `ffmpeg`):

```
node --env-file=.env.local --experimental-strip-types scripts/build-switchboard-samples.mts [caller ids] [--force]
```

Only the caller is recorded. In the demo the clips are played into a real speech-to-speech session and the Agent answers live.
