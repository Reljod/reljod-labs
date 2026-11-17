import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "rulebooks-rules",
  section: "concepts",
  title: "Rulebooks and Rules",
  summary:
    "Rules are data an admin edits; the checks that use them are code (ADR 0015).",
  body: [
    md`
## Rule

A **Rule** is one check a Pipeline makes, written as a plain sentence with its changeable parts as Parameters. It can be switched off. It says what happens when it is not met (its Outcome). It cites where it comes from and carries the date it took effect.

The check itself is code. The Rule supplies only its Parameters. A new kind of check is a code change. A new value is not.

## Parameter

A **Parameter** is a value inside a Rule that an admin may change without touching code: a number of days, a rate, an amount, a list. Each Parameter has a type (money, percent, days, months, years, a number, a choice or a list) and limits such as a minimum and a maximum. A bad edit is refused where it was made, with one error per field.

## Outcome

The **Outcome** of a Rule is what a Rule that is not met does to the Run:

`,
    { live: "outcomes" },
    md`
## Version

Saving never overwrites. It adds a **Version**. Version 0 is the Default that ships with the Harness. Every Run records the Version of every Rule it applied, so you can explain an old decision after the Rule changes.

## Rulebook

A Pipeline's Rules together are its **Rulebook**. It is also a Skill, so the Agent and Claude read the same Rules a Run enforces. See [Skills](#doc:skills).

## Why Rules are data

If rules live only in prompts, a model decides eligibility and nobody can say which rule produced a decision. If they live only in code, a change of a number needs an engineer. Here, the number is data and the logic is code. Models never return a Finding. See [Why a harness for a bank](#doc:why-a-harness-for-a-bank) and [Decisions](#doc:ref-decisions).

## The Rules in this build

`,
    { live: "rules" },
    md`
The Rules follow the published shape of the Cayman National Pensions Act and are illustrative. See [The rules reference and its limits](#doc:rules-reference).

To edit a Rule, see [Rules editor](#doc:app-rules). To add one, see [Add a Rule](#doc:ops-add-rule).
`,
  ],
};
