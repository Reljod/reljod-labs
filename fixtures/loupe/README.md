# Loupe corpus

The synthetic Corpus for Loupe, the forensic examiner for documents: genuine originals, each with tampered and benign variants, a Manifest of what was done to each, and the Sweep recorded for every one. Every person, employer, bank, utility and number is invented; the setting is the fictional Republic of Meridia (capital Port Selene, currency M$ / MRD, postcodes MRn-xxxx), and every Document carries a SPECIMEN watermark. Domain words are in `src/features/loupe/GLOSSARY.md`.

## What is in it

53 Documents from 14 originals: 27 PDFs and 26 images.

| Kind | Originals | Issuers | Formats |
| --- | --- | --- | --- |
| Payslip | 3 | Tidewater Logistics Ltd, Corvane Shipyards plc | 2 PDF, 1 scan |
| Bank statement | 3 | Port Selene Savings Bank, Lantern Quay Credit Union | 3 PDF (one of 1 page, two of 2 pages) |
| Utility bill | 3 | Halcyon Water & Power, Brightline Telecom | 1 PDF, 2 scans |
| Invoice | 2 | Saltmarsh Print Works, Greywether Timber Supply | 1 PDF, 1 scan |
| Identity card | 3 | Republic of Meridia, Civil Registry (two series) | 3 scans |

- PDFs are digital-born (reportlab), with a text layer and embedded subset fonts. Each issuer has its own accent colour, header, typefaces (Liberation Sans, Serif and Mono, Bitstream Vera) and date style. Each names its own system as Producer (`Tidewater Payroll Engine 7.3`, `PSSB CoreStatements 12.1`…), which is on neither the editor list nor the benign list.
- Scans are a rendered page put through a flatbed model: slight skew, paper tint, an uneven lamp, optical blur, even sensor noise and paper grain, then one JPEG save (quality 82 to 90). The identity card lies on a grey scanner bed. Its portrait is a drawn silhouette, never a face.
- Originals are consistent: lines add up to their totals, running balances reconcile, rates match their bases, check digits pass, dates agree.

## Numbers and their check digits

- **IBAN**: `MR` + 2 check digits + 4-letter bank code + 12-digit account, printed in groups of four. ISO 13616 mod 97. Bank codes: `PSSB`, `LQCU`, `MMBK`, `HBTC`.
- **Tax ID**: nine digits printed `NNN-NNN-NNC`. C is the Luhn digit of the first eight.
- **National ID / document number**: `MRD` + 7 digits + C. C is the ICAO 9303 digit (weights 7, 3, 1) of the seven digits.
- **Identity card MRZ**: three lines of 30. Line 1 `I<MRD` + 9-character document number + its check digit; line 2 birth date `YYMMDD` + check, sex, expiry `YYMMDD` + check, `MRD`, and a composite check digit last; line 3 `SURNAME<<GIVEN<NAMES`. All checks are ICAO 7-3-1. There is no OCR in the Toolkit, so the MRZ is for the Examiner to read and check with `loupe.ids`.

## Tampers

Each is recorded in the Manifest with its page, the box of what changed, the field, and the text before and after.

| Type | How it is made | Documents |
| --- | --- | --- |
| `text_edit` | The run's string replaced where it stands: same font resource, same anchor, same metadata. Produced by re-rendering the page with that one run changed, which is byte-for-byte what editing the string in the content stream gives. Two leave the arithmetic broken (one also carries an editor Producer); one is hard. | 3 |
| `overpaint_edit` | A rectangle in the background colour over the old run and new text on top, merged onto the page (pypdf). The old text stays in the stream. Stamped with an editor Producer and a later ModDate. | 2 |
| `font_substitution` | The replaced run set in another face (Vera for Liberation Sans, Sans Bold for Mono Bold), 0.35 pt larger or 0.8 to 0.9 pt off the baseline. In one the forger changed every dependent total too, so only the type gives it away. | 2 |
| `incremental_update` | The edited page content and resources appended to the untouched original as an incremental update (pypdf), the original objects still in the file. Two also rewrite the Producer in the update. | 3 |
| `date_change` | A transaction moved outside the statement period; a bill dated after its own due date; one hard. | 3 |
| `payee_change` | An IBAN whose check digits no longer match, with the payee renamed (once in place, once by overpaint); one hard. | 3 |
| `pasted_patch` | A flat paper-coloured rectangle over the figure and new anti-aliased text: no grain, no blur. Saved again as JPEG. | 4 |
| `copy_move` | Pixels copied from elsewhere on the page: once a whole amount over another (after covering the old one with a copy of blank paper), twice single characters. Saved again. | 3 |
| `resaved_region` | A careful edit (new text blurred and grained like the page), then the region around it saved at quality 48 to 55 and pasted back; the whole saved at 91 to 93. | 3 |
| `recompressed_splice` | The field cut from a second scan of the edited page with about half the noise, saved at quality 58 to 64 on an 8x8 grid shifted by (3, 5), pasted in; the whole saved once more. | 3 |

Editor Producers stamped: `Meridia PDF Editor 4.2`, `QuickEdit PDF 11`, `PixelForge 2026.1`.

## Benign changes

Genuine in the Manifest (`tampers: []`). A sensible Rulebook must not flag them.

| Type | How it is made | Documents |
| --- | --- | --- |
| `resave_pdf` | Re-saved through pikepdf, linearised or repacked into object streams, Producer `Meridia Office Print to PDF 2.4`, creation and modification dates equal. Content untouched. | 4 |
| `rescan` | The scan resized to 90 to 95%, sometimes blurred, and saved at quality 76 to 84. | 4 |
| `screenshot` | Page 1 of the PDF rendered and saved as JPEG at quality 90 to 91: no grain at all. | 2 |

## Hard cases

Three Documents have `hard: true`: an in-place edit in the page's own font that keeps every figure consistent (a raised salary with every total, deduction and net pay recomputed; a pay period and pay date moved together; an account holder renamed). Nothing the Sweep measures changes. They are what the Examiner is for, and they count against the detection rate below.

## Splits

Split by original: a variant is always in its original's split. Ids say the split and the kind: `lp-tr-payslip-01`, `lp-va-…`, `lp-te-…`; variants end `-t1` (tampered) or `-b1` (benign).

| Split | Originals | Tampered | Benign | Documents | Use |
| --- | --- | --- | --- | --- | --- |
| train | 6 | 12 | 5 | 23 | Tune the Checks and the thresholds |
| validation | 4 | 8 | 2 | 14 | Check a change before keeping it |
| test | 4 | 9 | 3 | 16 | Report only. Never tune on it |

Every split has PDF text edits, PDF structure edits, image edits and benign cases. 14 Documents are featured Samples (4 from train, 5 from validation, 5 from test).

## How the Sweep does (`tuning.json`)

`generate/tune.py` reads the recorded Sweeps and the Manifest, on train and validation only, and for each Metric puts the threshold halfway between the highest value measured on anything untouched and the lowest value on a Tamper above it. Where untouched Documents measure exactly 0 it takes the smallest value that means anything (M$ 0.02 for arithmetic, 1 hour, 0.01% of the page). A Measurement counts for a Tamper when its box overlaps the Tamper's on the same page; whole-file Metrics, and Metrics about a relation between figures (`arith.*`, `format.*`, `id.*`), count on any tampered Document, since a broken total is rarely printed on the edited line. A copy and its source are one piece of evidence. With "flagged = any Measurement at or over its threshold":

| Split | Tampered flagged | Without the hard ones | Genuine and benign flagged |
| --- | --- | --- | --- |
| train | 11 of 12 (92%) | 11 of 11 (100%) | 0 of 11 |
| validation | 5 of 8 (62%) | 5 of 7 (71%) | 0 of 6 |
| train + validation | 16 of 20 (80%) | 16 of 18 (89%) | 0 of 17 |
| test (reported, never tuned) | 7 of 9 (78%) | 7 of 8 (88%) | 0 of 7 |

Recommended thresholds (all `>=`): `pdf.incremental_updates` 1, `pdf.editor_producer` 1, `pdf.modified_gap_hours` 1, `pdf.covered_text` 1, `glyph.font_outlier` 0.675, `glyph.size_delta_pt` 0.275, `glyph.baseline_offset_pt` 0.9, `arith.*` 0.02, `format.date_anomaly` 1, `id.checksum_invalid` 1, `image.noise_ratio` 2.36, `image.ela_ratio` 2.85, `image.jpeg_ghost` 0.725, `image.copy_move` 0.01. Never fired on a Tamper in train or validation, so set above every untouched value or left at 1: `image.edge_halo` (3.38), `glyph.spacing_outlier`, `glyph.color_delta`, `format.style_break`, and `pdf.text_over_image` and `pdf.annotations`, which no Corpus Document exercises.

What the Sweep misses, and why:

- The three hard Documents, by construction.
- `lp-va-idcard-01-t2` and `lp-te-idcard-01-t2`: single copied characters. `copy_move` compares 14 px windows of grain; one digit is narrower than the window plus its filter, so its neighbours drown the match. The whole-amount copy in train is caught.
- `lp-va-invoice-01-t2`: a splice from a donor with half the page's noise at quality 64, over small print. Noise measures 1.65x and the ghost 0.53, both under thresholds that the benign rescans force (2.34x and 0.61).
- The margins are thin on pixels: the heaviest benign rescan measures 2.34x noise against a threshold of 2.36, and 2.65x error level against 2.85. With 17 clean Documents in train and validation, "0 false flags" is a small-sample claim.
- `image.edge_halo` separates nothing in this Corpus: pasted text and scanned text have skirts within 20% of each other after a JPEG save.

Checked outside the generator's style (a crude edit as the Forge bench makes it: a paper-coloured rectangle over a figure, new text in a default font, exported as JPEG 0.9 or PNG):

- A scan Sample (`lp-va-invoice-01`): caught both ways (noise 6.3x, error level 6.1x as JPEG and 10.9x as PNG, ghost 1.0); the untouched re-export stays clean (1.65x, 1.6x, 0.51).
- A low-grain rescan (`lp-tr-idcard-01-b1`): caught (noise 3.8x as JPEG, 4.1x and error level 22x as PNG). Its untouched JPEG re-export measures 2.85x error level, a hair over the 2.848 threshold: a third save of an already soft image is the Sweep's weakest benign case.
- A PDF Sample's page image (`lp-tr-payslip-01`, no grain): as PNG the edit is caught (4.4x: the page still sits on prepare's quality-88 grid and the new text does not; untouched 2.5x). As JPEG 0.9 it is not caught at all: nothing on a grainless page separates new print from old once both are re-saved.

## Files and commands

- `manifest.json`: `{version, generatedBy, documents}`, one `ManifestEntry` per Document (`src/features/loupe/domain/contract.ts`). Written by the generator; do not edit by hand.
- `corpus/<id>.<pdf|jpg>`: the Documents.
- `expected/<id>.json`: the Sweep the real Toolkit recorded: `{id, format, kindGuess, pages, measurements, checks, toolkitMs}`.
- `tuning.json`: thresholds and rates per split and per Tamper type, with the Documents missed.
- `public/loupe/samples/<id>/`: for each featured Sample, `document.<ext>`, `p<n>.jpg` exactly as `prepare` renders them, the Sweep's Evidence layers and `sweep.json`.
- `generate/`: `corpus.py` (models and page templates), `sheet.py` (drawing, field boxes), `forge.py` (scans, Tampers, benign changes), `build.py` (the plan and the Manifest), `record.py` (runs the Toolkit), `tune.py`, `preview.py`, and `fonts/` (Latin subsets of the Liberation fonts, SIL Open Font License 1.1).

```bash
node --experimental-strip-types scripts/render-loupe-corpus.mts   # corpus, manifest, expected, samples, tuning.json
node --experimental-strip-types scripts/build-loupe-data.mts      # then pack the Toolkit and the Corpus for the app
uv run --python 3.14 --with-requirements src/features/loupe/toolkit/requirements.txt python fixtures/loupe/generate/preview.py   # layers over pages, into .preview/
```

It needs `uv`; nothing is installed globally. A global gitignore drops `*.pdf`, so add the Corpus PDFs and the Samples' `document.pdf` with `git add -f`.

## Determinism

Seeded PRNGs (Python `random`, numpy PCG64), no clock, no network, fixed PDF dates and deterministic `/ID`s. Two renders give byte-identical Documents, Manifest, page images, layers, Measurements and `tuning.json`. The only bytes that differ are timings: `toolkitMs` and `checks[].ms` in `expected/*.json` and `sweep.json`. Byte identity holds for the pinned library versions; another libjpeg, FreeType or pdfium build can move pixels.

Changing a template, a seed or a Tamper changes the Documents: re-run the script and commit the Manifest, the expected Sweeps and `tuning.json` with it. Changing a Check changes only the last two.

## Decisions taken without asking

- 53 Documents rather than 60 to 70, at the lead's request for a smaller Corpus; invoices have two originals, not three.
- No scanned-PDF original and no annotation Tamper, so `pdf.text_over_image` and `pdf.annotations` are implemented but not exercised here.
- Screenshots are JPEG, not PNG, because every `.png` in a Sample's folder is read as an Evidence layer.
- A copy is reported twice, once at each end, since pixels cannot say which end is the original. Scored against the Manifest, the source end counts as a Finding that touches no Tamper.
- `image.ela_ratio` and `image.noise_ratio` are `max(r, 1/r)`: an edit usually makes a region quieter than the page, not louder.
- A pay date before the end of its pay period is not an anomaly (employers pay before month end); a pay date outside the period, or more than 45 days after it, is.
