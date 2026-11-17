import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "rules-reference",
  section: "desk",
  title: "The rules reference and its limits",
  summary:
    "Where the Rules come from, what was verified, and what is only illustrative. Not legal advice.",
  body: [
    md`
> The Rules are for a software demo about a fictional bank. They follow the published shape of the Cayman National Pensions Act for illustration. They are not legal advice and must not be used to decide a real pension case.

## Where they come from

The research note is in the repository at §fixtures/harness/RULES-REFERENCE.md§. It was written for this demo, and it dates its own findings: every "current" statement there means current as far as the sources read on the date of the research. Each Rule in the Harness cites a section of the Act, the General Regulations or a guidance note, and shows the date its Default took effect.

The regulator in the Act is the Director of Labour and Pensions. The research found no pensions role for the banking regulator.

## How certain each value is

The note labels every rule one of three ways:

- **verified-primary**: read in the Act, the regulations, a Bill or a guidance document of the regulator;
- **verified-secondary**: read only in a law-firm note, a news report or a provider's document;
- **unverified**: no reliable source found, or the value is a demo design choice.

## What the research could not verify

These are the main gaps. The note lists them all.

- The 2018 Revision of the General Regulations was not read. Periods that come from regulations need checking against it.
- Three Cabinet Orders were not read as text. Their effect is taken from summaries.
- Documents required for an overseas transfer, a death claim and retirement were not found in a source.
- The prime rate for late interest was not sourced.
- Any tolerance for rounding in contribution checks is a demo choice.

## What this means when you use the demo

- Treat a Finding as a demonstration of how a Rule works, not as a statement of what the law requires.
- A Rule marked unverified in the note is a design choice. An admin can change its Parameters, and that is the point of Rules being data.
- A person must read any Draft before it goes anywhere. In the demo, nothing goes anywhere.

## The Rules in this build

`,
    { live: "rules" },
    md`
## Reading the Rules in the app

Open the [Skills tab](#tab:skills) to see each Rule as a card with its Parameters, Outcome, citation and Versions. See [Rules editor](#doc:app-rules).
`,
  ],
};
