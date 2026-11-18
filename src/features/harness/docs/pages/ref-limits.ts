import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ref-limits",
  section: "reference",
  title: "Limits",
  summary: "Every cap on paid or unbounded work, read from the code.",
  body: [
    md`
The demo calls paid models, so every path that can add paid work is capped. The caps live in one place, §LIMITS§ in §domain/limits.ts§, and are applied in the server function, so the app, the chat and the MCP server all count against the same numbers. Hourly limits count against the visitor, and the rest against the Workspace.

## Limits

`,
    { live: "limits" },
    md`
## The Sandbox

`,
    { live: "sandbox-limits" },
    md`
How they are applied is in [Sandbox design](#doc:arch-sandbox).

## Skills

`,
    { live: "skill-limits" },
    md`
## When you hit one

You get a 429 and a sentence that says which limit and, for an hourly one, that you can try again later. Nothing is lost. A limit never stops a Run that is already going.
`,
  ],
};
