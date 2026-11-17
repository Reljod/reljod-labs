import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "app-rules",
  section: "using",
  title: "Rules editor",
  summary:
    "Change a Rule's Parameters, Outcome and effective date on its card, and see every Version.",
  body: [
    md`
A Pipeline's Rules appear in its Rulebook in the [Skills tab](#tab:skills), as cards grouped by Step.

## A Rule card

A card shows:

- the sentence, with its Parameters in place as inline fields;
- the Outcome if the Rule is not met;
- the citation, and the date the Rule takes effect;
- a switch to turn the Rule off;
- its Version, and whether it differs from the Default.

## Editing

Only an admin can edit. Change a Parameter, the Outcome, the effective date or the switch, add a note, and save. The server checks every field against the Rule's schema: type, range, step and the allowed options. A bad value is refused, with one message per field at fault, and nothing is saved.

Saving adds a **Version**. Version 0 is the Default. You can restore the Default or an earlier Version, which adds a new Version.

## Try it

1. Run a case and note the Findings.
2. Change a Parameter, for example a number of days, and save.
3. Run the same case again.
4. Compare the two Runs: each Finding shows the Rule Version it used.

That is how the Harness can explain an old decision after a Rule changes.

## What you cannot change here

You cannot add a new kind of check. A check is code. You change its Parameters only. See [Add a Rule](#doc:ops-add-rule).
`,
  ],
};
