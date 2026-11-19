# Loupe Toolkit

The Python package the Sandbox runs: the Checks, and the helpers your own code imports. Python 3.14, no network. Pinned libraries: pillow, numpy, opencv-python-headless, scipy, scikit-image, pikepdf, pypdf, pdfminer.six, pypdfium2, reportlab, python-stdnum, python-dateutil (`requirements.txt`). No OCR.

Everything is located by two environment variables: `LOUPE_WORK` (the work dir; the Document, its page images and cached text runs) and `LOUPE_OUT` (where this run writes). `import loupe` needs nothing else.

## Boxes and pages

A box is `[x0, y0, x1, y1]`, each 0..1 of the page, origin top-left. Pages are 1-based; page 0 means the whole Document.

## Helpers

```python
import loupe
loupe.fmt()                 # "pdf" or "image"
loupe.page_count()
loupe.doc_path()            # the file itself
loupe.page_image(n)         # PIL RGB: the rendered page of a PDF, the original pixels of an image
loupe.page_array(n)         # the same as uint8 (h, w, 3)
loupe.to_px(box, n)         # box -> (x0, y0, x1, y1) pixels of page_image(n)
loupe.to_box(px_rect, n)    # pixels -> box
loupe.text_runs(n)          # PDF only, paint order. Each run: text, font, size (pt), box, x0 y0 x1 y1,
                            # baseline (0..1), baselinePt, x0pt, x1pt, color [r,g,b], alpha, render,
                            # rotated, seq, chars [[char, x0pt, x1pt], ...]
loupe.shapes(n)             # PDF only: filled shapes and images in paint order: kind, fill, color, alpha, box, seq
loupe.page_text(n)          # the text layer, line by line
loupe.pdf()                 # pikepdf.Pdf (PDF only); use `with loupe.pdf() as pdf:`
loupe.ids.iban_ok(s)  loupe.ids.tax_id_ok(s)  loupe.ids.national_id_ok(s)  loupe.ids.mrz_ok(field, check)
```

A run painted later has a higher `seq`; a shape with a higher `seq` than a run was painted over it.

## Reporting a Measurement

Only what you report becomes a Measurement. The metric must be one of the fixed Metrics, or `report` raises.

```python
loupe.report(metric, value, page, box=None, detail="", facts=None, layer=None, layer_kind=None)
```

`value` is a finite number in the Metric's unit. `detail` is one sentence with the numbers (400 characters at most). `facts` is `{name: number or short string}`. It appends one line to `$LOUPE_OUT/reports.jsonl`.

Metrics: `pdf.incremental_updates`, `pdf.editor_producer`, `pdf.modified_gap_hours`, `pdf.covered_text`, `pdf.text_over_image`, `pdf.annotations`, `glyph.font_outlier`, `glyph.size_delta_pt`, `glyph.baseline_offset_pt`, `glyph.spacing_outlier`, `glyph.color_delta`, `image.ela_ratio`, `image.noise_ratio`, `image.jpeg_ghost`, `image.copy_move`, `image.edge_halo`, `arith.sum_mismatch`, `arith.balance_break`, `arith.rate_mismatch`, `format.date_anomaly`, `format.style_break`, `id.checksum_invalid`.

## Evidence layers

Transparent PNGs with the page's aspect ratio (1000 px wide), written to `$LOUPE_OUT`. Each returns the file name to pass as `layer=`, with `layer_kind` "heatmap", "marks" or "compare".

```python
loupe.heat_layer(name, intensity, page)        # intensity: 2-D array 0..1 covering the whole page, any resolution
loupe.mark_layer(name, page, boxes, labels=None)
loupe.compare_layer(name, page, box, "printed", 4810.50, "recomputed", 4100.50)
loupe.save_layer(name, rgba)                   # your own RGBA array (h, w, 4) or PIL image
```

## Checks from code

Each Check is `loupe.checks.<id>(page=None, box=None)` and returns a list of Measurement dicts (it writes its layers itself). To keep one: `loupe.report(**m)`. With a `box`, a pixel Check always returns one Measurement for that region, remarkable or not.

| Check | Metrics | What it does |
| --- | --- | --- |
| `pdf_structure` | `pdf.incremental_updates`, `pdf.editor_producer`, `pdf.modified_gap_hours`, `pdf.text_over_image`, `pdf.annotations` | Sections appended after the first save that change page content (a linearised file's two sections are one save); the Producer and Creator the file names (`facts.producer`); hours from creation to modification. These three are always reported, once per PDF, page 0. |
| `pdf_overpaint` | `pdf.covered_text` | Text still in the content stream under a later opaque rectangle or image, with what is drawn on top (`facts.hidden`, `facts.shown`). |
| `glyphs` | `glyph.*` | Every figure (a run that is mostly digits) against the figures in its column and the runs on its line. Words are scored for font only, in a font the page hardly uses. A size step over 1.5 pt is read as design. |
| `arithmetic` | `arith.*` | Rows whose label starts with total, subtotal, gross pay, net pay or amount due against the lines above them or the totals before them; a running-balance table row by row and its summary; a row with a percentage against that rate of a labelled base. Label heuristics, no layout knowledge. A mismatch is reported only when another sum in the Document verified. |
| `dates_formats` | `format.*` | Dates that are not real days, entries outside the Document's own period, a pay date outside its period, a date after its own due date; a date or figure written unlike its column. |
| `checksums` | `id.checksum_invalid` | IBANs (mod 97), Meridian Tax IDs (Luhn), Meridian National IDs (7-3-1). |
| `ela` | `image.ela_ratio` | Error level over paper when re-saved at quality 95, 85 or 70 (the most telling is kept), against the same kind of paper on the page. For a PNG whose pixels still sit on a JPEG grid, it finds that quality and maps what does not sit on it, print included. |
| `noise` | `image.noise_ratio` | Grain over paper against the page, like with like: paper 2 px from print with paper 2 px from print, open paper with open paper. |
| `jpeg_ghost` | `image.jpeg_ghost` | How far a region's error curve across re-saves at qualities 50 to 90 is from the page's, 0..1. |
| `copy_move` | `image.copy_move` | Look-alike places (SIFT) that also carry the same grain: print repeats, grain does not. Each copy is reported with its twin (`facts.twin`). |
| `edge_halo` | `image.edge_halo` | Width of the skirt between ink and paper (contrast over steepest slope) against the page's. |

Ratios are `max(r, 1/r)`: 1 is "like the page"; `facts.direction` says above or below.

## What a Check cannot see

- A page with no grain (a screenshot, a PDF page render) gives `noise`, `jpeg_ghost` and `copy_move` nothing to read: they report 1.0, 0 and 0 and say so. Look, and reason from the content.
- `copy_move` needs a copied area of a few characters; a single copied digit is under its window (14 px).
- "Noisier than the page" is only believed on open paper, so a louder patch that is all print is missed.
- A pixel spot smaller than four samples (16 px square) is reported at no more than the region floor, 1.65x.
- An edit that keeps every figure consistent, in the page's own font, leaves nothing for `arithmetic` or `glyphs`.
- `arithmetic` reads labels in English and amounts with two decimals.

## Command line

```
python3 -m loupe prepare --doc <file> --work <dir>
python3 -m loupe sweep --work <dir> --kind <kind> --out <dir>
python3 -m loupe check <checkId> --work <dir> --out <dir> [--kind K] [--page N] [--box x0,y0,x1,y1]
python3 -m loupe crop --work <dir> --page N [--box x0,y0,x1,y1] --out <file.jpg> [--max 1100]
```

Each prints one line of JSON last on stdout and exits 0; on failure it exits non-zero with a short message on stderr (2 for a refused Document or a bad argument). `prepare` reads the format from the file's first bytes, refuses anything but PDF, JPEG, PNG and WebP, more than 20 pages, more than 25 MB and encrypted PDFs, and writes `doc.json`, `pages/p<n>.jpg` (longest side 1600 px, quality 88; a JPEG Document up to 2400 px is copied as it is, so its pixels and compression history are the file's) and `runs/p<n>.json`. `sweep` and `check` write `<out>/measurements.json` as `{measurements, checks: [{check, ms, measurements, error?}]}` and their layers beside it.

The embedded figure font on compare layers is a subset of Liberation Mono Bold (SIL Open Font License 1.1), kept as text in `loupe/_font.py`.
