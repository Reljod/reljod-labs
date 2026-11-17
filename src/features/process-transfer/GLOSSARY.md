# Process transfer: glossary

The demo at `/demos/process-transfer` turns a recorded handover call into a workflow document and a slide deck. Use these words in code, copy and commits.

| Term | Meaning |
| --- | --- |
| **Recording** | The video of a call in which one person shows another how a process is done, usually by sharing their screen. A sample or an upload. |
| **Sample** | A Recording that ships with the demo (`public/process-transfer/samples/`). Synthetic: Meridian Bank & Trust, Republic of Meridia, SPECIMEN. |
| **Run** | One Recording going through the pipeline once. Belongs to an Owner. |
| **Stage** | One part of the pipeline: Watch, Extract, Verify, Document, Design, Check, Approve. |
| **Observation** | One moment of the call: the time, who spoke, what was said and what the shared screen showed. The Watch stage's output. |
| **Process** | The procedure the call hands over: purpose, trigger, roles, systems, steps, decisions, exceptions, controls, open questions. |
| **Step** | One instruction of the Process: who does what, where, with the time in the Recording that shows it. |
| **Workflow document** | The Process written up as a DOCX. Built by rule from the Process; no model writes it. |
| **Deck plan** | The slides as words (kind, title, bullets, notes). What a model writes. |
| **Deck** | The Deck plan laid out: every element with a position, a size and an entrance. The preview, the Checks and the PPTX all come from it. |
| **Rule** | One thing a Process or a Deck must satisfy, with Parameters a person may change. Data, in `domain/rules.ts`. |
| **Parameter** | A number on a Rule (a margin, a word limit). |
| **Check** | A Rule applied to one Process or Deck: passed or failed, with where. Code, in `process-checks.ts` and `deck-checks.ts`. |
| **Finding** | Something a reviewer model raised about the Process or the Deck: major or minor, with the change to make. |
| **Round** | One pass of Design and Check over the Deck. A failed Round sends its failures back to Design. |
| **Fit by rule** | The last Round's fallback: slides that still fail are split or trimmed by code, not by a model. |
| **Approval** | The verdict on the Deck: approved (no blocking Check failed, nothing major found) or held for a person. Only an approved Deck downloads as PPTX. |
| **Redo** | Running Design, Check and Approve again on a finished Run under the current Rules. |
| **Audit trail** | The append-only list of what a person and the pipeline did: runs, model calls with cost, Rule changes, Approvals, downloads. |
| **Owner** | Who a Run, the Rules and the Audit trail belong to. See `src/features/access/GLOSSARY.md`. |

Avoid: "meeting" for a Recording, "presentation" for a Deck, "validation" for a Check, "job" or "task" for a Stage.
