import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "conflicts",
  section: "concepts",
  title: "Conflicts and Resolutions",
  summary:
    "When a new document disagrees with an old one, a person settles which stands.",
  body: [
    md`
A **Conflict** is two Passages that say different things about the same fact. It is found when a Source is added. The Agent proposes how to settle it. An admin decides.

## How one is found

When a Source is added, each new Passage is searched against the existing ones. Close matches go to a model with one question: do these state different values for the same fact? A yes becomes a Conflict with both Passages, a summary and a proposed Resolution.
`,
    { diagram: "ingest" },
    md`
## Resolution

A **Resolution** is what a person decided:

| Resolution | Meaning |
| --- | --- |
| §supersede§ | The new Passage supersedes the old one. |
| §keep_both§ | Both stay, with their dates. |
| §set_aside§ | The new Passage is set aside. |

A superseded Passage is kept and marked, and no longer retrieved. Nothing is superseded without a person.

## Until it is settled

Both Passages are retrievable. An answer that cites either Passage says a Conflict is open.

## Who can settle one

Only an admin. Claude cannot settle a Conflict either: there is no MCP tool for it. §list_conflicts§ shows them, and a person settles them in the [Knowledge tab](#tab:knowledge). See [What Claude cannot do](#doc:claude-limits).

## Cost and limits

The check costs model calls. It is capped per Source (the number of new Passages checked) and ingest is capped per hour. See [Limits](#doc:ref-limits).
`,
  ],
};
