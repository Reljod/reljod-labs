# Name Extraction corpus

The synthetic Corpus for the Name Extraction demo (shown as Sieve): AML files of 10 to 500 pages, each with an exact Answer key of every party it names. Every person, company, bank, street, vessel and product is invented; the setting is the fictional Republic of Meridia (capital Port Selene, currency M$ / MRD, postcodes MR1-xxxx), and every page carries a SPECIMEN line. Domain words are in `src/features/name-extraction/GLOSSARY.md`.

The Documents are not stored. Each is generated from its seed by `src/features/name-extraction/domain/corpus` (own PRNG, no clock, no `Math.random`), so the same id gives the same pages and the same Answer key on every machine. A 500-page Document generates in well under 300 ms, so workflow steps regenerate it instead of loading it.

## What is in it

- 27 Documents in nine genres: SWIFT MT103 ledgers, bank statements, KYC files, corporate registry extracts, court judgments, SAR narratives, email and chat exports, trade finance files (letters of credit, bills of lading) and board minutes. Page counts 10, 25, 50, 75, 100, 150, 200, 250, 300, 400 and 500.
- 15 to 120 expected Names per Document, people and organizations. Long Documents concentrate names in a few sections with routine pages between them, and print some names only once near the end (one only on page 437 of a 500-pager), so a skimmer misses them.
- Hard cases: initials (`A. L. Ferreira-Vos`), `SURNAME, Given`, surname-first order (`CHEN Jiahui`, `VOLKOV NATALIA`), ALL CAPS, transliterations (Mohammed / Muhammad, Aleksandr / Alexander, Kuznetsov / Kouznetsov), nicknames (`Bill Ashworth`), titles (`Sheikh`, `Chief`, `Hon. Justice`), particles and hyphens (`van der Merwe`, `al-Rashid`, `de la Fontaine`), names broken across a line or a page break, names in tables, SWIFT fields (`:50K:`, `:59:`), signature blocks, email handles, lowercase OCR noise and one-letter typos, legal suffixes (Ltd, LLC, S.A., GmbH, Holdings, Trust, Foundation, LLP) and shell companies named like people.
- Hard-only parties: about 13% of each Document's parties (10-15% per Document, seeded, in every split) never appear in a clean form. Each is printed only as OCR-damaged lowercase text (`j0seph chinedu okonkwo`, `kestrel holdings grnbh`, lost hyphens and accents), in an unlabelled table cell, broken across a page break with no label, as an email local part (`t.okafor@...`; these carry `handleOnly` and count only when the Rulebook includes handles, see `answerKeyFor`), or as initials only (`V. Okonkwo`). The Sweep finds about 91-93% of all names; the rest is what the Readers and the Analyst are for.
- Decoys that are not parties: streets named after people (`Rua Almirante Costa`), vessels (`MV Santa Leonor`), products, places, job titles, form labels, months, and the bank's own boilerplate (`Meridia Central Bank`, `Republic of Meridia`, excluded by the default Rulebook).

The Answer key is computed from what was printed: each expected Name lists its canonical form, every other surface form actually printed, and every page it is printed on (both pages for a name split across a page break). `corpus.test.ts` checks that each printed form is on each listed page and that no decoy names the same party as an expected Name.

## Splits

| Split | Documents | Use |
| --- | --- | --- |
| train | 13 | Tune the Sweep, the Analyst's Skills and prompts |
| validation | 7 | Check a change before keeping it |
| test | 7 | Report only. Never tune on it |

Each split has at least two Documents of 100 pages or more and one of 500 pages. Ids say the split: `ne-tr-*`, `ne-va-*`, `ne-te-*`. Counts per Document are in `manifest.json`.

## Files and commands

- `manifest.json`: ids, titles, genres, splits, pages, seeds and Answer key sizes. Written by the script below; do not edit by hand.
- `public/name-extraction/samples/<id>.pdf`: three test Documents (10, 100 and 500 pages) printed as text PDFs, one PDF page per Document page, for trying an Upload with a real file.

```bash
node --experimental-strip-types scripts/render-name-extraction-corpus.mts   # rewrite manifest.json and the sample PDFs
pnpm test src/features/name-extraction                                       # Answer key exactness, Sweep recall per split
```

Changing a pool, a genre or a seed changes the Documents and their Answer keys: re-run the script and commit the manifest with the change. Scores from before the change are not comparable with scores after it.
