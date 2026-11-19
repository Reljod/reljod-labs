import type { SkillId } from "../domain/contract";

export type Skill = { title: string; description: string; body: string };

/**
 * The Examiner's Skills: playbooks loaded on demand with `load_skill`. Only
 * the one-line description sits in the instructions until then. Plain
 * strings, safe to import in the browser (the page shows them).
 */
export const SKILLS: Record<SkillId, Skill> = {
  "pdf-structure-forensics": {
    title: "PDF structure forensics",
    description:
      "Read a PDF as a file, not a picture: later saves, who wrote it, text hidden under patches, annotations, text over scans.",
    body: `# PDF structure forensics

## When to use
The Document is a PDF, and either the Sweep flagged \`pdf.*\` or a figure looks retyped.

## What a clean PDF looks like
An issuer's system writes the file once: one cross-reference section (two if it is
linearised), one Producer, creation and modification dates equal or minutes apart,
every text run drawn once.

## Steps
1. \`run_check pdf_structure\`: later saves that changed content
   (\`pdf.incremental_updates\`), the Producer (\`pdf.editor_producer\`, decided by the
   Rulebook's editors list), the date gap, annotations, text over a full-page image.
2. \`run_check pdf_overpaint\` on the suspect page: \`pdf.covered_text\` finds text still in
   the content stream but hidden under an opaque shape with other text on top. Its
   \`facts.hidden\` is what the page used to say.
3. For an incremental update, show what changed with code: \`loupe.pdf()\` is a
   \`pikepdf.Pdf\`. Read the raw bytes with \`open(loupe.doc_path(), "rb").read()\`, split
   on \`%%EOF\`, and open the first revision alone (bytes up to the first \`%%EOF\`) to
   compare the page's text before and after. Print both figures.
4. A benign re-save (a print driver, a scanner) rewrites the whole file once and
   changes no content: one section, a Producer on the benign list. Say so and move on.

## Traps
- A linearised PDF has two sections and was not edited.
- A modification date alone is context, never proof.
- Do not report a count you did not get from code.`,
  },
  "image-splicing": {
    title: "Image splicing",
    description:
      "Find a pasted, copied or separately re-saved region in a scan or photo: error level, noise, JPEG ghosts, copy-move, halos.",
    body: `# Image splicing

## When to use
The Document is an image (or a PDF page that is one full-page scan) and a figure, a
date or a name looks pasted: sharper or flatter than its neighbours, a box of cleaner
paper around it, digits identical to digits elsewhere.

## Steps
1. Look at the page, then zoom on each money figure, date, name and number with
   \`look\` and a box. Compare a suspect figure with an ordinary one on the same line.
2. \`hypothesize\` each suspicion with its box before you test it.
3. Test the same box with at least two independent Checks:
   - \`ela\`: error level of the region against the page (\`image.ela_ratio\`).
   - \`noise\`: grain of the region against the page (\`image.noise_ratio\`). A patch
     drawn in an editor has almost none.
   - \`jpeg_ghost\`: a second compression history inside the region.
   - \`copy_move\`: the region is a copy of another area of the page.
   - \`edge_halo\`: halos around pasted glyphs.
4. Every ratio is against the page, so a whole-page re-save (a scanner, a
   screenshot) stays near 1 everywhere. One region far from 1 is the signal.
5. \`conclude\` with the Measurement ids. One Check that trips is supporting; two
   independent ones on the same box make the case.

## Traps
- Solid colour areas, logos and the SPECIMEN watermark have their own statistics.
  Compare text with text and paper with paper.
- A high ratio over most of the page is a benign re-save, not an edit.`,
  },
  "statement-arithmetic": {
    title: "Statement arithmetic",
    description:
      "Recompute what the document claims: lines against totals, running balances, tax against its rate, dates against the period, check digits.",
    body: `# Statement arithmetic

## When to use
Any Document with money on it. A forger changes the figure that matters and forgets
the ones that depend on it.

## Steps
1. PDF with a text layer: \`run_check arithmetic\`, \`dates_formats\` and \`checksums\`
   read the numbers exactly. Review what they return.
2. Image, or a layout the Check could not parse: read the figures yourself with
   \`look\` (zoom until every digit is certain), then recompute them in \`run_code\`.
   Put the figures in the code as literals with their labels, compute, and report the
   difference:
   \`\`\`python
   import loupe
   lines = {"Basic salary": 4200.00, "Overtime": 310.50}
   printed_gross = 4810.50
   diff = round(abs(sum(lines.values()) - printed_gross), 2)
   loupe.report("arith.sum_mismatch", diff, page=1, box=(0.62, 0.41, 0.80, 0.44),
                detail=f"Gross pay printed {printed_gross:.2f}, lines sum to {sum(lines.values()):.2f}",
                facts={"printed": printed_gross, "computed": sum(lines.values())})
   \`\`\`
   Use Decimal or round to cents. Report the difference even when it is 0: a
   Hypothesis is refuted by a number too.
3. Statements: check every row, balance = previous balance + credit - debit, and
   opening + credits - debits = closing.
4. Rates: tax = rate x base, within a cent or two of rounding (\`arith.rate_mismatch\`).
5. Dates: inside the period, in order, real days. Numbers with check digits: the
   Corpus README's rules are in \`loupe.ids\`.

## Traps
- A figure you read from pixels may be misread. Zoom and read it twice before
  calling a mismatch.
- A careful forger fixes the totals too. Then arithmetic is clean and only the
  pixels or the file structure can show the edit.`,
  },
  "font-forensics": {
    title: "Font forensics",
    description:
      "Compare each text run of a PDF with its neighbours: font, size, baseline, spacing, ink colour.",
    body: `# Font forensics

## When to use
A PDF with a text layer where a figure, date or name looks retyped, or the Sweep
flagged \`glyph.*\`.

## Steps
1. \`run_check glyphs\` on the page, or on a box around the suspect run. It compares
   each run with the runs it sits with (the other amounts in its column, the rest of
   its line): \`glyph.font_outlier\`, \`glyph.size_delta_pt\`,
   \`glyph.baseline_offset_pt\`, \`glyph.spacing_outlier\`, \`glyph.color_delta\`.
2. To see for yourself, list the runs in code:
   \`\`\`python
   import loupe
   for r in loupe.text_runs(1):
       print(r["text"][:30], r["font"], r["size"], round(r["baseline"], 2), r["color"])
   \`\`\`
   Embedded fonts carry a subset prefix (\`ABCDEF+Name\`). A run in a font used
   nowhere else in its column is the classic sign of an editor's substitution.
3. Zoom with \`look\` to confirm what the numbers say: a figure a fraction of a point
   lower, a slightly different black.

## Traps
- Headings, totals in bold and logos differ on purpose. Compare a run only with
  runs of the same role.
- One metric a hair over its threshold is supporting, not decisive.`,
  },
  "writing-a-finding": {
    title: "Writing a Finding",
    description:
      "How a Hypothesis becomes a Finding: what to measure, how to report it, what to say to the reviewer.",
    body: `# Writing a Finding

A Finding is not your opinion. It is a Measurement that trips a Rule. You supply the
suspicion, the code, and the words a human reviewer reads.

## The loop
1. **See.** \`look\` at the page, then at regions. Say what you see in a thought.
2. **Suspect.** \`hypothesize\` with the page, the box and one concrete claim:
   "Net pay 4,810.50 sits lower than its row and is a flatter black than the
   figures above it." Not "this looks fake".
3. **Measure.** \`run_check\` a named Check on that box when one fits. Otherwise
   \`run_code\` and call \`loupe.report(metric, value, page, box, detail, facts)\` under
   one of the fixed Metrics. A named Check can be decisive; your own code counts as
   supporting at most, because anyone can re-run a named Check.
4. **Settle.** \`conclude\` the Hypothesis with the Measurement ids:
   - \`supported\` only if a Measurement trips its Rule. The tool refuses otherwise.
   - \`refuted\` when the numbers are ordinary. That is a good result: say so.
5. **Review.** For each Sweep Finding, \`review_finding\`: \`agree\` or \`doubt\`, with the
   reason a reviewer needs ("the 1.9x error level is the logo's solid colour, not an
   edit"). Your stance is shown; it does not change the Verdict.
6. **Finish.** \`finish\` with a short summary for the reviewer: what was checked,
   what was found where, what was ruled out, and what you could not test.

## Writing for the reviewer
- Plain words, the place, the number, the threshold: "Net pay (page 1, lower right)
  has 6.2x less noise than the page; the Rule flags 3x."
- Say what an innocent explanation would be and whether the numbers rule it out.
- Never say "forged" or "fraud". The Verdict is Genuine, Suspicious or Tampered, and
  it is evidence for a person to weigh.
- Do not claim anything code did not measure.`,
  },
};

/** The one-line list of Skills for the Examiner's instructions. */
export function skillIndex() {
  return (Object.entries(SKILLS) as [SkillId, Skill][])
    .map(([id, skill]) => `- ${id}: ${skill.description}`)
    .join("\n");
}
