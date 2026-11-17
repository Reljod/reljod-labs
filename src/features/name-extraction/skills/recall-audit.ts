/** Skill: find what was missed before finishing. */
export const recallAudit = {
  title: "Recall audit",
  description:
    "Before finish: diff Sweep Candidates against the Register in code, re-read flagged pages (optionally with a second model family), dismiss the rest with reasons.",
  body: `# Recall audit

## When to use
After the first pass (Readers back, code findings recorded, aliases folded) and
before \`finish\`. Also whenever \`finish\` is refused with open Candidates.

## Steps
1. Diff in code. \`run_code\` reads \`/vercel/doc/candidates.json\` (status \`open\`,
   \`recorded\`, \`dismissed\`) and \`/vercel/doc/register.json\`, and prints:
   - open Candidates grouped by signal and by page, with counts;
   - **flagged pages**: pages where the Sweep's Candidate count is high but no
     Name in the Register has a mention there; pages of a Reader that failed or
     returned nothing (\`/vercel/doc/readers.json\`);
   - **missing mentions**: for each Name, pages where \`grep\` finds its canonical or
     an alias but its mentions do not list the page.
2. Re-read the flagged pages only. Spawn Readers over small ranges (3 to 8 pages)
   with a focus line naming what to look for. For a second opinion, pass a model of
   a different family (\`model: "openai/gpt-6-luna"\` when the Readers were
   Anthropic, \`"anthropic/claude-haiku-5.5"\` when they were OpenAI): different
   families miss different names. The second model must be no pricier than the
   Run's Reader model (input and output price), or the call is refused.
3. Work through the open Candidates:
   - It is a party: add it (or add it as an alias of an existing Name) with
     \`record_names\`; matching Candidates close by themselves.
   - It is not a party: dismiss it with a reason that an examiner would accept,
     grouped: \`candidates: [{ ids: [12, 40, 41], dismiss: "street names (Ferreira
     Avenue)" }]\`. Use code to select the ids of a whole group (headers, labels,
     headings, places) and dismiss them in one call.
   - Not sure: record it as a Name with low confidence and a note. Recall first.
4. Check the gate in the tool result. When \`pagesRead\` equals \`pagesTotal\` and
   \`candidatesOpen\` is 0, call \`finish\`.

## Example (run_code)
\`\`\`js
import { candidates, register, readers, perPageCounts, out } from "/vercel/doc/sieve.mjs";
const named = new Set(register().flatMap(n => n.mentions.map(m => m.page)));
const counts = perPageCounts(candidates());
const flagged = Object.entries(counts).filter(([p, c]) => c >= 8 && !named.has(+p)).map(([p]) => +p);
const failed = readers().filter(r => r.error || r.names === 0).map(r => [r.from, r.to]);
const open = candidates({ status: "open" });
const bySignal = {};
for (const c of open) for (const s of c.signals) (bySignal[s] ??= []).push(c.id);
out({ flagged, failed, open: open.length, bySignal: Object.fromEntries(Object.entries(bySignal).map(([s, ids]) => [s, ids.length])) });
\`\`\`

## Pitfalls
- Dismissing open Candidates in bulk without looking at a sample of each group.
- Re-reading the whole Document "to be safe": it doubles the cost. Re-read flagged
  pages only.
- A vague reason ("not relevant"). Say what it is: "column header", "street",
  "the bank itself (excluded by the Rulebook)".`,
};
