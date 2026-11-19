# Vellum sample screens

Four self-contained HTML screens a visitor can pick as the screenshot Vellum redraws: a Meridia Rail mobile e-ticket (`rail-ticket`, 390x844), a Port Authority of Meridia berths dashboard (`harbour-dashboard`, 1280x800), a Tidewater Bank landing hero (`tidewater-card`, 1280x720) and a Meridia Ferry Week poster (`ferry-poster`, 900x1200). Everything in them is fictional and set in the Republic of Meridia, and each carries a SPECIMEN tag. They use inline CSS and system font stacks only, with flat colour regions and a modest number of elements, so they make fair targets for a vector redraw.

Re-render them with `pnpm render:vellum-samples` (Playwright's Chromium; set `CHROMIUM_PATH` to use another build). It writes `public/vellum/samples/<slug>.png` at scale 1 and a 320px wide `<slug>.thumb.jpg`. A new screen needs an entry in the script's `SCREENS` and in `src/features/vellum/domain/samples.ts`, whose test checks the PNG sizes match.
