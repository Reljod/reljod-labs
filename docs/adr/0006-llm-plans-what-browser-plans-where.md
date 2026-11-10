# The model plans what Ledger does, the browser plans where

Ledger answers a visitor's question by rebuilding the site into an answer page. The model (`zai/glm-5.3-flash` through Vercel AI Gateway) writes the Build plan: which Content blocks to cut, in what order, whether each is fetched or tossed, how fast Ledger runs to it, what he says, and the answer page's title and layout from a fixed set. It never writes positions, speeds or poses. The browser measures the real page and picks the gait from the direction of travel, the grip from the block's size, and where everything lands. Each step names a source path that the page marks with `data-ledger-source`, plus an optional excerpt. Code drops any step whose path does not exist or whose excerpt is not a word-for-word substring of that source, so every word on the answer page is the site's own. We chose this over letting the model choreograph coordinates, which a flash model cannot measure and which break on every viewport, and over a fixed catalog of pre-cut blocks, which would stop Ledger from cutting a single figure out of a sentence.

## Consequences

- Hallucinated facts cannot reach the answer page. The chat answer is free text from the model and is only as grounded as the instructions make it.
- Steps stream: each is played as soon as the model finishes writing it and it passes validation, so Ledger starts moving before the plan is complete.
- A stored Build keeps paths and excerpts, not words. Plans are validated again on read, so a source the site no longer shows is dropped from replays instead of rendering stale text.
- Adding content to `src/content` adds Content blocks automatically, but a new piece only becomes cuttable once its section marks it with `source(...)`.
- Stubbed e2e runs replace the model with canned plans that go through the same validation, storage and stream; only requests carrying the e2e bypass token can reach them.
- ADR 0007 amends this: Joins, the model's few linking words between blocks, are the only words on the answer page that are not the site's own.
