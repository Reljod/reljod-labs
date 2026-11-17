/** Skill: write code that runs over the Document's pages in the Sandbox. */
export const sandboxCoding = {
  title: "Sandbox coding",
  description:
    "The files on disk in the Sandbox, the sieve.mjs helper library and worked examples for run_code (JavaScript, no network, 60 s).",
  body: `# Sandbox coding

## When to use
Whenever a question is about many pages at once: counting, listing every value of
a field, finding where a name appears, clustering names, selecting Candidate ids
to dismiss. Code keeps the pages out of your context; only what you print comes back.

## The Sandbox
- A Vercel Sandbox microVM with Node.js. **No network.** Each \`run_code\` call runs
  your code as an ES module (\`node file.mjs\`), with a 60 s limit. stdout and stderr
  come back capped at about 8,000 characters each: print summaries, not pages.
- Files (read only; rewritten before each call, so they are current):
  - \`/vercel/doc/pages/0001.txt\`, \`0002.txt\`, ...: one file per page, page 1 first.
  - \`/vercel/doc/meta.json\`: \`{ id, title, pages }\`.
  - \`/vercel/doc/candidates.json\`: the Sweep's Candidates,
    \`{ id, text, typeGuess, pages, count, signals, status, reason? }\`.
  - \`/vercel/doc/register.json\`: the Register, \`ExtractedName[]\`
    (\`canonical, type, aliases, roles, mentions: [{ page, quote }], confidence, foundBy, note\`).
  - \`/vercel/doc/readers.json\`: every Reader so far, \`{ from, to, model, names, error? }\`.
  - \`/vercel/doc/sieve.mjs\`: the helper library below.
- Code cannot change the Register. Print what you found, then call \`record_names\`
  (set \`foundBy: "code"\` on Names your code found).

## sieve.mjs
\`\`\`js
import {
  pages,          // () => string[]           pages()[0] is page 1
  page,           // (n) => string            one page
  lines,          // (n) => string[]          a page's lines
  joined,         // (n) => string            a page with wrapped lines joined
  grep,           // (regex, { from, to }) => [{ page, line, text, match, groups }]
  candidates,     // ({ status }?) => Candidate[]
  register,       // () => ExtractedName[]
  readers,        // () => Reader runs
  perPageCounts,  // (candidates) => { [page]: count }
  fold,           // (s) => folded key: lower case, no diacritics, no honorifics or punctuation
  tokenSet,       // (a, b) => boolean        same tokens in any order
  initialsMatch,  // (a, b) => boolean        "A L Ferreira-Vos" ~ "Ana Lucía Ferreira-Vos"
  jaroWinkler,    // (a, b) => 0..1           OFAC-style prefix bonus
  out,            // (value) => prints JSON, capped
} from "/vercel/doc/sieve.mjs";
\`\`\`

## Examples
Every SWIFT ordering and beneficiary customer, with pages:
\`\`\`js
import { pages, out } from "/vercel/doc/sieve.mjs";
const found = new Map();
pages().forEach((text, i) => {
  const re = /^:?(50[KF]|59A?):\\s*(?:\\/[^\\n]*\\n)?(?:1\\/)?([^\\n]+)/gm;
  for (const m of text.matchAll(re)) {
    const name = m[2].trim();
    if (!/^\\/|^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(name)) {
      const e = found.get(name) ?? { field: m[1], pages: [] };
      e.pages.push(i + 1); found.set(name, e);
    }
  }
});
out([...found].map(([name, e]) => ({ name, ...e, pages: [...new Set(e.pages)] })));
\`\`\`
Ids of open Candidates that are table headers:
\`\`\`js
import { candidates, out } from "/vercel/doc/sieve.mjs";
const headers = /^(account holder|beneficiary|counterparty|name of applicant|value date)$/i;
out(candidates({ status: "open" }).filter(c => headers.test(c.text)).map(c => c.id));
\`\`\`
Where a Name appears but its mentions do not say so:
\`\`\`js
import { register, grep, out } from "/vercel/doc/sieve.mjs";
const esc = s => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");
out(register().map(n => {
  const listed = new Set(n.mentions.map(m => m.page));
  const hits = grep(new RegExp(esc(n.canonical), "i")).map(h => h.page);
  return { name: n.canonical, unlisted: [...new Set(hits)].filter(p => !listed.has(p)) };
}).filter(r => r.unlisted.length));
\`\`\`

## Pitfalls
- Printing whole pages: the output is capped and you lose the rest. Print counts,
  ids and short quotes.
- \`fetch\` or \`npm install\`: there is no network. Use the helpers and Node built-ins.
- Long loops with catastrophic regexes: keep patterns simple and anchored; the
  60 s limit kills the run.
- Treating code output as final: a regex finds forms, you decide what is a party.`,
};
