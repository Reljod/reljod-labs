import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ops-add-rule",
  section: "operations",
  title: "Add a Rule",
  summary: "A new value is data. A new kind of check is code.",
  body: [
    md`
Read [Rulebooks and Rules](#doc:rulebooks-rules) first.

## A new value for an existing check

You do not need code. An admin edits the Parameter in the [Skills tab](#tab:skills). If the Default should change for everyone, change it in §domain/rules/defaults.ts§.

## A new Rule

1. **Add a §RuleSpec§** to §RULE_SPECS§ in §domain/rules/defaults.ts§:
   - §id§, §pipelineId§, the §stepId§ whose check uses it, and a §title§;
   - §sentence§: plain words, with each changeable part as a §{name}§ slot;
   - §params§: a type for each slot (money, percent, days, months, years, a number, a choice or a list) with its limits;
   - §defaults§: a value for each;
   - §defaultOutcome§: §block§, §refer§ or §warn§;
   - §citation§: where it comes from, as exactly as you can;
   - §effectiveFrom§: a date, §YYYY-MM-DD§.
2. **Use it in the Step's check.** The check reads the Rule's current Parameters and returns a Finding. A Rule that is switched off is skipped.
3. **Test it** with edge cases: at the limit, one over, one under.

## Writing a good Rule

- State one thing.
- Cite the section. If you are not sure of the source, say so in the citation and mark the value as a design choice.
- Keep the sentence readable by a person who does not read code.
- Do not put a judgment in a Parameter. A Parameter is a number, an amount, a choice or a list.

## What happens next

The Rule appears on its card in the Rulebook, in the Rulebook Skill's text, in the Findings of the next Run (with Version 0), and in these Docs.
`,
  ],
};
