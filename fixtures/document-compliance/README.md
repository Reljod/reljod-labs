# Document compliance fixtures

Synthetic Document packs for the document compliance demo. Every document is issued by the fictional Republic of Meridia and carries a SPECIMEN watermark. None depicts a real person, issuer or document design.

| Pack | Deliberate flaw | Requirements that should not pass |
| --- | --- | --- |
| `clean` | None | none |
| `expired-passport` | Passport expired before the Pre-screen date | `identity-document-not-expired`: fail |
| `stale-bill` | Utility bill older than 3 months | `proof-of-address-recent`: fail |
| `name-mismatch` | Bill addressed to a different first name, same surname | `name-matches`: needs review |
| `tampered-passport` | Expiry date pasted over in another font; the MRZ keeps the real, past date | `identity-document-not-expired` and `no-tampering`: needs review |
| `incomplete-certification` | Certified copy missing the certifier's occupation and date | `certification-complete`: fail |

Each pack holds three Documents, one per parser path:

- `identity-document.jpg`: photo of a passport data page (OCR)
- `proof-of-address.pdf`: born-digital utility bill with a text layer (opendataloader-pdf)
- `certified-copy.pdf`: image-only scan of a certified passport copy (OCR)

`pack.json` holds the Client declaration, the fixed Pre-screen date and the expected Finding for every Requirement, so each pack doubles as a test fixture.

## Regenerating

Requires Google Chrome and Pillow.

```bash
python3 fixtures/document-compliance/generate.py
```

Output is deterministic apart from Chrome's PDF metadata.
