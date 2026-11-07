# Extract fields with AI, evaluate Requirements in code

A Pre-screen runs in two stages: the model extracts fields from each Document with a confidence per field, then deterministic code applies the Rulebook's Requirements to those fields. The model judges directly only where no field can carry the answer: legibility, tampering and fuzzy name matching. We chose this over asking the model to judge every Requirement end to end so that date and expiry rules are testable without the model, every Finding traces back to an extracted field a Reviewer can see, and a `Fail` is never the product of model guesswork.

## Consequences

- A Requirement is data (a field, an operator, a threshold), so Rulebook values such as "3 months" change without a prompt change.
- A low-confidence extraction downgrades any Finding that depends on it to `Needs review`, never `Fail`.
