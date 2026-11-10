# Casework fixtures

The synthetic Cabinet for the Casework desk: 200 labelled documents, 50 per review, in 48 case files. Every person, company, bank, law firm, screening product and publication is fictional, and every page carries a SPECIMEN watermark and a synthetic-document footer. Cayman geography, land registry conventions and the National Pensions Act rules are used for realism; no real document design, seal or crest is copied.

| Scenario | Cases | What they exercise |
| --- | --- | --- |
| `pension_withdrawal` | 13 | Home purchase, mortgage reduction and early retirement; the CI$50,000 cap, balances, Caymanian status, permitted lenders, payees, married names, earlier withdrawals |
| `employer_onboarding` | 12 | Company papers, member censuses, signatories, PEP and sanctioned directors, and contribution files with short, late and missing months |
| `structure_review` | 10 | Layered companies, trusts (discretionary, STAR), a foundation company, nominees, missing registers, a PEP settlor |
| `screening_review` | 13 | False positives on date, nationality, gender, namesakes and deceased PEPs; true matches; transliteration and name-order cases |

## Layout

- `cases/<scenario>/<slug>/case.json`: the case, its documents, each document's `label` (the fields a correct Read returns, per `src/features/casework/domain/document-kinds.ts`) and `expected` (checks, recommendation, missing kinds, hits, UBOs, arrears, risk). Schema: `src/features/casework/domain/case-file.ts`.
- `cases/<scenario>/<slug>/*.html|*.csv`: one source per document, rendered by `render.mjs` as a born-digital PDF, a scanned PDF, a phone photo or a CSV.
- `watchlist/*.json`: the synthetic sanctions, PEP and adverse media list the `screen` Job checks.
- `splits.json`: train, validation or test per case, 60:20:20 by document within each scenario, written by `split.mjs`. Whole cases go to one split. Screening's 3- and 4-document cases cannot hit 10 exactly, so it splits 28/11/11.

## How it was made

Four authoring agents wrote one scenario each against the shared contract. Two independent reviewer agents then checked every label against the rendered pages: 2,800 values, every CSV cell, every sum. They found no wrong field values. Their fixes were missing-document expectations, brand-name collisions and a scan watermark that washed out.

## Commands

```bash
node fixtures/casework/render.mjs --check      # validate every case.json
node fixtures/casework/render.mjs               # render all to out/ (git-ignored)
node fixtures/casework/render.mjs --only <slug> # render one case
node fixtures/casework/split.mjs                # rewrite splits.json
pnpm seed:casework                              # upload out/ to Supabase Storage and record the case files
```

`GOLDEN_REPORT=1 pnpm test src/features/casework` prints how often the rules reach the labelled recommendation with perfect reads, per split.
