# Let the model correct OCR text, never its location

Amends ADR 0001. Tesseract (ADR 0004) finds where every line and column sits on a page reliably, but on low-resolution scans it misreads characters, such as "Vethsco" for "VELASCO" or garbled digits in a machine-readable zone. ADR 0001 only let the model cite Spans whose text already held the value, so a misread surname or expiry could only end as `Needs review`. The model now returns Span corrections in the same call that reads the fields: for an OCR'd Span whose text differs from the page image, its ref and the text as printed. Code applies a correction only to a Span that exists and only to its text; the box always stays the parser's, and the model still never produces coordinates. Fields are then verified against the corrected text. We chose this over letting the model return lines with boxes, whose positions could not be checked, and over a heavier OCR model in the function bundle.

## Consequences

- Corrections apply only to Documents parsed by OCR; a PDF text layer is exact and is never rewritten.
- A corrected Span's text is the model's reading of the page, so a Finding that rests on it is only as good as that reading. Every correction is logged in the run as it happens (`✎ p1-s7 "Vethsco" → "VELASCO"`).
- Only the corrected text is stored, so a stored run's Spans show what the model read, not the raw OCR. Keeping both would need an extra column; not needed for the demo.
- No extra model call: corrections ride on the extraction call, before the fields.
