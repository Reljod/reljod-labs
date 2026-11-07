# Reljod Labs

Portfolio and service site for Reljod Oreta, AI consultant for banking and financial services. Built with Next.js (App Router), Tailwind CSS 4 and the [Colonnade](https://claude.ai/artifact/HJP49abWMYrhjyPmkPez2Y) design system.

## Commands

```bash
pnpm install
pnpm dev      # local dev server
pnpm lint     # biome check
pnpm build    # production build
```

## Editing content

All copy lives in typed data files under `src/content/`, so most updates never touch a component.

| File | What it holds |
| --- | --- |
| `profile.ts` | Name, headline, intro, contact links, hero case file and highlight figures |
| `services.ts` | "What I do" services and the four-step approach |
| `experience.ts` | Work history and credentials |
| `projects.ts` | Project cards. The home page shows the first `FEATURED_PROJECT_LIMIT` (6) |
| `navigation.ts` | Header and footer anchor links |

Project entries are templates. Replace bracketed placeholders such as `[Outcome metric]` with real, approved figures, and set `href` once a case study exists to turn on its "Read case study" link.

## Design system

Colonnade tokens (colors, hard shadows, radii, fonts) are defined in `src/app/globals.css` under `@theme`. Rules to keep:

- Every box has a 2px `ink` outline (`outline-box`). Shadows are hard offsets, never blurred.
- Headings, labels, buttons and figures use IBM Plex Mono in uppercase. Body copy uses Inter.
- `brass` appears once per screen: the contact band.
- Buttons use the `press` utility: lift on hover, stamp down on press, `federal-blue` focus ring.
