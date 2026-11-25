# 0034. Vellum: the model draws a typed Drawing, the browser measures it

Date: 2026-11-19. Status: accepted.

## Context

GPT-6.2 Astra (OpenAI, 17 November 2026) shipped with the claim that it can take a screenshot as a template and match its layout, colours and font sizes. Vellum shows that claim and makes it measurable: the model redraws a screen, and code says how close it came. Four things had to be decided: what the model writes, who scores it, how the score reaches the next attempt, and what is kept.

## Decisions

**1. The model writes a Drawing in a typed grammar (`vellum.drawing/1`), never HTML or SVG.** A Drawing is a Palette, a Type scale, a background and Marks (box, ellipse, line, one line of text), on a Sheet 1000 units wide (`domain/drawing.ts`). The model's schema is loose so a strict structured-output mode accepts it; `sanitizeDrawing` then clamps every number to the Sheet, accepts colours only as `#rrggbb`, strips control characters, bounds text and ids and caps the Marks at 600. The page draws with React, and the SVG the Ruler rasterizes escapes every string (`domain/svg.ts`). Model-written markup would need a sandbox and could not be animated mark by mark; a grammar can be streamed, diffed by id and tweened.

**2. Only code scores, and it scores in the browser.** `domain/ruler.ts` is pure: it compares the Screenshot and the rendered Drawing on a 280-pixel-wide copy, per Cell of a 20-across grid, as Colour (redmean distance) and Edges (SSIM on brightness over 8 × 8 windows). The browser already holds both images and renders the Drawing for display, so measuring there costs no upload and no server CPU. The number is the visitor's own account, like Switchboard's reported events (ADR 0029): forging it only misleads their own next Pass, and the server's caps hold whatever it says.

**3. A later Pass gets numbers, not words, from the browser.** Pass 2 onward sends the last Drawing (sanitized again on the server), its rendering, the Likeness and up to 16 Notes. A Note is coordinates, two hex colours and a score, checked by zod; the server writes every sentence the model reads (`domain/brief.ts`). A visitor can send a misleading number but not an instruction. The model is also handed the Screenshot "squared up" with the Sheet's grid ruled and labelled over it, which turns placement into reading coordinates off a grid.

**4. Nothing is kept.** A Trace lives in the tab: no Screenshot, Drawing or Measurement is stored, so there is no Owner data, no bucket and no purge to register. The one table is the rate limiter's (`vellum.rate_hits`: a salted visitor hash, a kind, a time), pruned to a day as it goes. A Pass is the unit counted: 12 per visitor per hour and 300 across everyone per day, taken in `takePass` after the request and every image have been checked (`preparePass` decodes each against its magic bytes) and before the model is called.

**5. Marks stream as they complete.** The route streams NDJSON: each Swatch, Type step and Mark is sent once, when the item after it has begun (`partialReporter` in `server/pass.ts`), then the whole sanitized Drawing at the end as the authority. The page releases Marks at a steady pace whatever bursts they arrive in, inks new ones in, and glides a Mark whose id it saw in the last Pass from where it was to where it now is.

## Consequences

- System fonts are drawn on the page and in the raster alike, so a perfect Likeness is out of reach by design; the Ruler rewards size, weight and position, which is what the model controls.
- A new kind of Mark is a change to the grammar, the sanitizer, the SVG writer and the Stage together.
- The model is `VELLUM_MODEL` (default `openai/gpt-6.2-astra`) at `VELLUM_REASONING` (default `low`); swapping it needs no other change, which also makes Vellum a bench to compare vision models on.
