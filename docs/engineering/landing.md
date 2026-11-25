# Landing page, catalog and About

Read this before you change `src/components/landing/`, `src/components/catalog/`, `src/components/motion/`, `src/content/` or the About page.

## Landing page

- `/` is a tour you scroll through, for a visitor outside tech (`src/components/landing/`): Paperwork, Up close, Who's reading, Seven problems (a Rolodex), What this site is, then a short finale, Coming soon and Contact.
- Each chapter is a `Chapter` (`src/components/motion/`): a pinned stage whose scroll progress is the CSS variable `--p`, read by pieces through `scroll-math.ts` expressions, so scrolling never re-renders React. Animate only transforms and opacity. The next section slides over a finished chapter (`overlap`).
- The tour plays whatever the visitor's reduced-motion setting, because nothing moves unless they scroll; only autoplay and looping motion honours it.
- Words live in `src/content/landing.ts`; facts about Reljod come only from `profile.ts`, `experience.ts` and `projects.ts`.
- A new live demo needs a plain problem in `demoProblems` and a preview in `demo-previews.tsx` (`landing.test.ts` and `demo-previews.test.ts` check them).

## Catalog (`/demos`)

- `/demos` lists every live demo (`src/components/catalog/`) as an index card whose preview stays paused (`animation-play-state`) until the card is hovered, focused or, on touch, centred, so a preview must animate with CSS only.
- Search, shelves and sort are pure functions in `catalog-query.ts`; shelves are `demoShelves` in `landing.ts`, so put a new demo on any shelf that fits.

## About

- The About sections also render inside Ledger's Ask sessions, which measure them, so their motion runs only under `CopyMotionProvider` (on `/about` and `/`); without it every motion piece renders plain.
