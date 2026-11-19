# Loupe

A forensic examiner for documents. One agent is handed a payslip, a bank statement, an invoice, a utility bill or an identity card (a PDF or an image) and works out whether it was tampered with, where and how. It looks, forms Hypotheses, and tests each one with code in a Sandbox. Only what code measured can become a Finding, and Rules in code decide the Verdict. The result is evidence for a human reviewer, not a decision about a person.

## Language

**Document**:
One file under examination, a PDF or an image. Either a Sample, or an Upload.
_Avoid_: File, input, attachment

**Sample**:
A Corpus Document shown on the page so the first click works. Shared with everyone, read-only.

**Upload**:
A Document an Owner brought. It is the Owner's, lives in the private bucket and is never used as a Sample.

**Forgery**:
An Upload made on the Forge bench: a Sample the visitor edited in the browser, saved with the list of Edits they made.

**Edit**:
One change a visitor made on the Forge bench (a changed figure, a moved date, a pasted patch), with the box it touched. The Edits of a Forgery are its ground truth.

**Corpus**:
The synthetic Documents (fictional Republic of Meridia, SPECIMEN), each genuine original with its tampered and benign variants, a Manifest and a Split (train, validation, test). Tune on train and validation only.
_Avoid_: Dataset, fixtures

**Manifest**:
What was done to each Corpus Document: every Tamper, its type and its box. Nothing in it is shown to the Examiner.
_Avoid_: Answer key, labels

**Tamper**:
One recorded alteration of a Corpus Document (edited amount, pasted patch, incremental-update edit…).
_Avoid_: Attack, manipulation

**Benign change**:
Processing that alters a file without altering what it says: a scanner re-save, a print-to-PDF, a screenshot. It must not make a Document Tampered.

**Examination**:
One run of the Examiner over one Document: its Trail, its Measurements, Hypotheses, Findings, Verdict and cost.
_Avoid_: Run, job, scan

**Examiner**:
The one agent. It looks at pages, forms Hypotheses, runs Checks and writes code. There is no fixed pipeline; the Examiner picks its next tool.
_Avoid_: Analyst, detector, bot

**Sweep**:
The model-free pass that runs every applicable Check before the Examiner starts. It sets the deterministic floor.

**Check**:
A named forensic routine in the Toolkit (error-level analysis, PDF structure, arithmetic…). It returns Measurements and, where it can, an Evidence layer. The Sweep runs all of them; the Examiner or an outside client can run one on a region.
_Avoid_: Detector, test, analyzer

**Toolkit**:
The Python package preinstalled in the Sandbox: the Checks and the helpers the Examiner's own code imports.

**Measurement**:
One number code produced about a page or a region, under a known Metric, with where it was taken and which code produced it. A model never writes one.
_Avoid_: Signal, score, feature

**Metric**:
What a Measurement measures (`image.ela_ratio`, `arith.sum_mismatch`…). The list is fixed in code; each Rule reads one.

**Hypothesis**:
What the Examiner suspects after looking ("the net pay sits lower than its line"). It stays open until code tests it: supported by a Measurement that trips a Rule, or refuted.
_Avoid_: Suspicion, guess, lead

**Finding**:
A Measurement that trips a Rule: the place, the measured value against the threshold, the Rule's Weight, the Evidence layer and the code. Only code returns a Finding.
_Avoid_: Flag (that is a Finding the Examiner has not reviewed yet), alert, hit

**Evidence layer**:
An image code drew over the page to show a Finding: an error-level map, glyph outlier marks, two sums side by side.
_Avoid_: Overlay, heatmap (one kind of layer)

**Rule**:
One editable sentence with Parameters: the threshold a Metric is held to, which Document kinds it applies to, and its Weight.

**Weight**:
How much a Rule's Finding counts toward the Verdict: `decisive` (alone makes a Document Tampered), `supporting`, or `context` (shown, never counted).

**Rulebook**:
An Owner's Rules together. Versioned: every edit writes a new version, and every Examination records the version it was decided under.

**Verdict**:
Genuine, Suspicious or Tampered, decided by the Rulebook from the Findings. The Examiner's opinion does not enter it.
_Avoid_: Result, decision, score

**Re-evaluate**:
Deciding a finished Examination again under the Owner's current Rulebook, from its stored Measurements. No model call, no Sandbox.

**Done gate**:
What the harness checks before `finish` may end an Examination: every page looked at, every Sweep Finding reviewed, every Hypothesis settled.

**Duel**:
A Forgery's Examination scored against its Edits: how many the Examiner caught, and what it flagged that the visitor never touched.

**Calibration**:
How the Sweep under a Rulebook does on the Corpus: detection rate, false-positive rate and localisation per Split. Shown on the page next to every claim.

**Sandbox**:
A Vercel Sandbox microVM with no network, the Toolkit installed and the Document on disk, where Checks and the Examiner's code run.

**Skill**:
A playbook the Examiner loads on demand (PDF structure forensics, image splicing, statement arithmetic, font forensics, writing a Finding).

**Trail**:
An Examination's events, append-only and ordered: every model call with its cost, every tool call, every piece of code with its output, every Measurement and the Rulebook version.
_Avoid_: Log, history

**Audit trail**:
The Owner's writes outside an Examination, append-only: a Rulebook saved, an Upload made, a token minted, a Re-evaluate.
