# Document Compliance Checks

AI pre-screening of client documents against a regulated firm's compliance requirements, so a person only reviews what needs judgment.

## Language

### Submissions

**Document pack**:
Everything submitted for one client case, such as an identity document, a proof of address and their certifications.
_Avoid_: Submission, bundle, application

**Document**:
One submitted file inside a Document pack.
_Avoid_: Upload, attachment

**Client declaration**:
The details the client states on their application (full name, date of birth, residential address) that every Document is checked against.
_Avoid_: Application data, profile, form data

**Span**:
A piece of text read from one page of a Document together with the box that encloses it on that page.
_Avoid_: Token, block, region, OCR result

**Extracted field**:
A named value read from a Document, such as date of birth or expiry date, that points to the Spans it was read from.
_Avoid_: Attribute, entity, key-value

### Rules

**Rulebook**:
A named set of Requirements for one kind of Document pack in one Jurisdiction, such as "Individual onboarding, Cayman".
_Avoid_: Policy, checklist, ruleset

**Requirement**:
One rule a Document pack must satisfy, such as "Proof of address issued within 3 months".
_Avoid_: Rule, check, control

**Jurisdiction**:
The regulatory regime a Rulebook encodes.
_Avoid_: Region, country, locale

### Outcomes

**Finding**:
The outcome of checking one Requirement against a Document pack: `Pass`, `Fail` or `Needs review`, with its Evidence.
_Avoid_: Result, check result, issue

**Field check**:
The mark on one Extracted field as soon as its Document is read: the field compared with the Client declaration or a Rulebook threshold, such as a passport expiry date compared with the Pre-screen date. It shows where a Finding will come from, but is not one.
_Avoid_: Field finding, flag, annotation

**Fail**:
A Finding where a confidently read value clearly breaks a Requirement, such as a passport expired on the Pre-screen date.
_Avoid_: Reject, error

**Needs review**:
A Finding that rests on judgment or uncertain reading, such as suspected tampering, poor legibility or a borderline name match.
_Avoid_: Warning, flag, unclear

**Evidence**:
The location in a Document that supports a Finding: the page, field and excerpt.
_Avoid_: Proof, source, citation

**Pre-screen**:
Producing Findings for a Document pack before a person looks at it. It never approves or rejects a client.
_Avoid_: Approval, verification, decision

**Pre-screen run**:
One execution of a Pre-screen against a Document pack, holding everything it produced: Spans, Extracted fields and Findings.
_Avoid_: Job, check, session

**Reviewer**:
The person who owns the decision on a Document pack and resolves every `Fail` and `Needs review` Finding.
_Avoid_: Approver, checker, analyst
