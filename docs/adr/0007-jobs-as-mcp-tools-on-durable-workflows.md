# Jobs are MCP tools that start durable workflow runs; rules decide, models read

The Casework desk runs four reviews (pension withdrawal, employer onboarding and arrears, structure file review, screening hit review). Each review is a Pipeline: an ordered list of Jobs from one registry (`domain/jobs.ts`), and most Jobs appear in more than one Pipeline (Sort, Read and Decide in all four; Screen, Adjudicate and Match identity in three).

Every Job and every Pipeline is a tool on the Casework MCP server (`/api/casework/mcp`, Streamable HTTP via `mcp-handler`), generated from the registries, so adding a Job adds a tool. The chat agent (the Specialist) is an MCP client of that server. It reaches it in-process, passing the route handler as the client's `fetch`, but the requests are real MCP over HTTP. An outside client such as Claude can call the same tools with `CASEWORK_MCP_TOKEN`. A tool call starts a Vercel Workflow run and returns its id at once. The run streams events (plan, job states, fields read, checks, hits, questions, cost, log) that the desk plays back.

Before each Job the run checks the Job's Needs against the sorted Documents. When one is unmet, it records a Question and waits on a workflow hook (`createHook`, raced against a 30-minute `sleep`). The person answers by dropping Documents on the question, with a button, or in chat, where the Specialist calls `answer_question`. Answers resume the hook with `resumeHook`. Jobs can raise their own Questions too, such as a surname change with no marriage certificate, or a screening hit with nothing to compare it against.

Models do three things: sort (what is this Document), read (fields, traced to the page's spans) and write (adjudication reasons, the decision summary). Code does every rule: identity, the National Pensions Act limits, payee, reconciliation at 5% + 5% capped at M$7,250 with prime + 5% interest, effective ownership at 10%, risk and the recommendation. The model can only overrule a rule's first disposition of a screening hit, the one place a reviewer weighs evidence rather than applies a threshold.

We chose this over one large agent with free-form tools, which cannot show a regulator why a case was declined. We also rejected hard-coding four separate workflows, which would duplicate Sort, Read and Screen four times and could not run "just the extraction".

## Consequences

- The rules are testable without a model: `golden.test.ts` runs every rule Job over the labelled Cabinet as if Read were perfect and scores the recommendation per Split.
- A Job run on its own adds the Jobs it depends on (`planJobs`); "screen these" runs Sort, Read, Screen.
- A run that loses its human waits 30 minutes, then goes on without the answer and records a Gap.
- Scans and photos go through Tesseract as in document compliance (ADR 0004), so fields can be boxed on the page; `CASEWORK_OCR=0` reads them by vision alone.
- Every model call is recorded with the gateway's reported cost; the desk stops starting runs once a session has spent the demo's cap.
- Settings (model, reasoning, temperature, output limit) are per purpose: code defaults, then `casework.model_settings` rows, then the session's overrides.
