# Reljod Labs

Reljod Oreta's lab of working AI demos for banking and financial services. Built with Next.js (App Router), Tailwind CSS 4 and the [Colonnade](https://claude.ai/artifact/HJP49abWMYrhjyPmkPez2Y) design system.

| Route | What it shows |
| --- | --- |
| `/` | The lab: live demos as large panels with moving previews, upcoming work floating on the bench |
| `/about` | Reljod: services, approach, experience, selected work and contact |
| `/demos/document-compliance` | Document compliance checks demo |
| `/demos/ledger` | Ledger, the cat banker, who rebuilds the About page into an answer |
| `/demos/casework` | The Casework desk: a specialist agent running four review pipelines as MCP tools on durable workflows |
| `/api/casework/mcp` | The Casework MCP server (bearer token required) |

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
| `lab.ts` | The lab's name, tagline and landing headline |
| `profile.ts` | Name, headline, intro, contact links and highlight figures |
| `services.ts` | "What I do" services and the four-step approach |
| `experience.ts` | Work history and credentials |
| `projects.ts` | Every demo and project. `status: "Live"` puts one on the landing stage; anything else floats on the bench. The About page shows the first `FEATURED_PROJECT_LIMIT` (6) |
| `navigation.ts` | Header and footer links |

Project entries are templates. Replace bracketed placeholders such as `[Outcome metric]` with real, approved figures, and set `href` once a case study exists to turn on its "Read case study" link. A new live demo also needs a moving preview: add one under `src/components/showcase/previews/` and register it by slug in `live-demos.tsx`. Add new projects at the end of the list: Ledger's source paths point at projects by index.

## Design system

Colonnade tokens (colors, hard shadows, radii, fonts) are defined in `src/app/globals.css` under `@theme`. Rules to keep:

- Every box has a 2px `ink` outline (`outline-box`). Shadows are hard offsets, never blurred.
- Headings, labels, buttons and figures use IBM Plex Mono in uppercase. Body copy uses Inter.
- `brass` appears once per screen: the contact band.
- Buttons use the `press` utility: lift on hover, stamp down on press, `federal-blue` focus ring.
