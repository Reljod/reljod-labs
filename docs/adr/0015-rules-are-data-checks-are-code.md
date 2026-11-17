# Rules are data an admin edits; the checks that use them are code

Pension rules change every one to three years. If the rules live only in prompts, a model decides eligibility and nobody can say which rule produced a decision. If they live only in code, a change of a number needs an engineer.

A Pipeline's checks are pure functions in `src/features/harness/domain/pipelines/`. Each takes the case facts and a Rule's Parameters and returns a Finding. The Rule itself is data: a sentence template with typed Parameters, an on/off switch, an Outcome (`block`, `refer`, `warn`), a citation and an effective date. Defaults ship in code (`domain/rules/`); an edit saves a new Version for the Workspace. A Run records the Version of every Rule it applied, so an old decision can be explained after the Rule changes.

A Pipeline's Rules together are its Rulebook, which is also a Skill: the server renders the current Rules to `SKILL.md` text, so the Agent and Claude read the same rules a Run enforces. People edit Rule cards (inline Parameters, grouped by Step), not that text. Models only read documents and write Drafts; they never return a Finding.

## Consequences

- A new kind of check is a code change; a new value is not.
- Parameters are validated against the Rule's schema on save (type, range), so a bad edit is refused where it was made.
- Calculations (days late, amounts, rate checks) are done in code and shown with their inputs.
- The Rules follow the published shape of the Cayman National Pensions Act and are illustrative. Each cites its source; the Docs say plainly that this is a demo, not legal advice.
