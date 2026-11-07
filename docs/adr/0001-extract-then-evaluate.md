# Extract fields with AI, evaluate Requirements in code

A Pre-screen runs in two stages: the model extracts fields from each Document, then deterministic code applies the Rulebook's Requirements to those fields. The model judges directly only where no field can carry the answer: legibility, tampering and fuzzy name matching. We chose this over asking the model to judge every Requirement end to end so that date and expiry rules are testable without the model, every Finding traces back to an Extracted field a Reviewer can see, and a `Fail` is never the product of model guesswork.

The model never reads coordinates or invents locations. Parsers (opendataloader-pdf and PaddleOCR) turn each Document into Spans with bounding boxes; the model answers each field with Span IDs only, and code confirms the value actually appears in those Spans' text. Boxes therefore always come from a parser, never from the model.

## Consequences

- A Requirement is data (a field, an operator, a threshold), so Rulebook values such as "3 months" change without a prompt change.
- A low-confidence extraction, an unknown Span ID or a value not found in its Spans downgrades any Finding that depends on it to `Needs review`, never `Fail`.
