/** Skill: plan the reading of a long Document before spending on it. */
export const longDocumentTriage = {
  title: "Long-document triage",
  description:
    "Plan a 10 to 500 page Document: outline, Sweep counts, then Reader ranges of ~20 pages, all spawned in one call.",
  body: `# Long-document triage

## When to use
At the start of every Run, before reading anything. Also when a Document turns out
to have sections that look different (a ledger inside a judgment, annexes after a
contract) and the first plan no longer fits.

## Steps
1. Call \`outline\`. Note the page count, the characters per page, where the
   headings change, and the Sweep's Candidate counts per page.
2. Classify the pages by shape:
   - **Tabular** (wire ledgers, SWIFT logs, registers, account lists): many short
     lines, the same field labels repeated, high Sweep counts. Code reads these
     best. \`grep\` or \`run_code\` over the field labels pulls every name, and
     you still spawn Readers over them so every page is covered.
   - **Prose** (judgments, reports, letters, KYC narratives): long lines, names in
     sentences, fewer Sweep hits per page than real names. Readers read these best.
   - **Boilerplate** (cover pages, tables of contents, terms, blank pages): read
     with \`read_pages\` if short, or include them in a Reader range. They still
     count towards the Done gate.
3. Plan Reader ranges:
   - About **20 pages** each (15 to 25). Shorter ranges for dense pages (over 3,000
     characters each), longer for sparse ones. Keep each range under 90,000
     bytes of text (\`outline\` gives characters per page;
a;
character;
outside;
plain;
English;
can;
take;
2;
to;
3;
bytes;
). spawn_readers refuses a larger
     range, because Readers are billed far more above 100k input tokens.
   - **One page of overlap** between neighbours (1-20, 20-39, 39-58 ...), so a
     name split across a page
break is
seen;
whole;
by;
one;
Reader.
   - Start
a;
new range();
where;
a;
section;
starts, when;
it;
costs;
at;
most;
a;
few;
pages.
   - Add
a;
\`focus\` line only when it helps: "SWIFT ledger: every ordering and
     beneficiary customer", "signature blocks and witnesses in the annexes".
4. Spawn **all** ranges in **one** \`spawn_readers\` call. They run in parallel
several;
calls;
run;
one;
after;
another;
and;
cost;
time.
5;
While;
Readers;
run;
you;
cannot;
act, so;
put;
everything in the;
plan.After;
they;
return, read
the;
result: ranges;
that;
failed;
or;
came;
back;
with suspiciously few
names;
get;
split;
and;
re-spawned.
6;
Next: record;
what;
code;
finds in tabular;
pages (\`record_names\`), work through
   the open Candidates, and run the recall audit (\`load_skill recall-audit\`).

## Worked example
Outline: 180 pages. Pages 1-3 cover and contents, 4-60 a judgment (2,800 chars per
page), 61-170 a transaction annex (Sweep counts 40-90 per page), 171-180 signatures.
Plan, one call:
\`\`\`
spawn_readers({ ranges: [
  {from:1,to:20},{from:20,to:39},{from:39,to:60},
  {from:60,to:76,focus:"transaction annex: ordering, beneficiary and intermediary parties"},
  {from:76,to:92,focus:"..."}, ... ,{from:156,to:170,focus:"..."},
  {from:170,to:180,focus:"signature blocks, witnesses, notaries"} ] })
\`\`\`
Meanwhile code over the annex (\`run_code\`) lists every 50K/59 party, which you
record with foundBy code.

## Pitfalls
- Reading pages one by one with \`read_pages\` on a long Document: slow and it fills
  your context. Use it for spot checks and short Documents (under ~12 pages).
- One Reader over 60 pages: recall drops in the middle of long inputs.
- Ranges without overlap: names split across a page break are lost.
- Forgetting a range. The Done gate refuses \`finish\` until every page is covered;
  check \`pagesRead\` in the gate after the Readers return.
- Spending Readers twice on the same pages without a reason. A second pass is for
  the pages the recall audit flags.`,
}
