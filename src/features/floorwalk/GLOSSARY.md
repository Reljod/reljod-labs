# Floorwalk glossary

Floorwalk watches body-camera footage of one walk through a workplace and says what to fix. Use these words, and only these, in `src/features/floorwalk/`.

- **Site**: a workplace that is walked. The Sample Sites (`domain/sites.ts`) are fictional premises in the Republic of Meridia, each with a Floor plan in metres. An upload has no Site.
- **Walk**: one pass of the Walker over the whole Footage, and what code made of it. A Walk lives in the visitor's browser; nothing is saved.
- **Footage**: the video walked. A Sample's is rendered from its Site (`fixtures/floorwalk/scene.html`); an upload's is the visitor's MP4 or MOV, kept for at most six hours.
- **Walker**: the model (Gemini 4 Neon). It watches the Footage and writes Lines. It never scores and never decides.
- **Line**: one NDJSON object the Walker writes: a **zone** line (it entered an area) or a **sighting** line.
- **Sighting**: what the Walker says it saw: a Rule it cites, a second, a box, a sentence, a confidence.
- **Finding**: a Sighting that passed every check in `checkSighting`. Only Findings count.
- **Noticed**: a Sighting that cites no Rule. It is shown and never scored.
- **Refused**: a Sighting that failed a check (no such Rule, outside the Footage, no box, unsure).
- **Merged**: a Sighting of a problem already found, folded into that Finding's `alsoAt`.
- **Standard**: the Rules a Site is held to, on or off, with a severity each. Data in `domain/rules.ts`; the visitor's edits live only in the page.
- **Rule**: one sentence of the Standard, with an id the Walker cites, a severity and how soon it must be fixed.
- **Score**: 100 less the weight of each counted Finding. Computed by `scoreWalk` from Findings and the Standard alone.
- **Band**: the words a Score earns: Fit to open, Fix today, Stop and fix.
- **Fix list**: the counted Findings, most severe and most urgent first, each with a deadline from the Footage's clock.
- **Answer key**: for a Sample, when each planted problem and each Decoy was in view and where, written by the render (`answer-key.generated.json`).
- **Planted problem / Decoy**: something put in a Sample on purpose: a broken Rule, or something that only looks like one (a spill that has its sign).
- **Recording**: a real Walk of a Sample, saved with the millisecond each event arrived, so the page can replay it for free.
- **Ask**: one more call over the same Footage, answering a question with Moments to jump to.
