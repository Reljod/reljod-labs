# Parse Documents inside the app with Tesseract and pdf.js

Supersedes ADR 0002. Once a Pre-screen ran as a Vercel Workflow (ADR 0003), each parse became its own step in the Next.js app, so a parser that runs in Node removes the separate container project entirely. Born-digital PDFs are read from their text layer with pdf.js, and images and scanned pages are OCR'd with Tesseract compiled to WebAssembly (tesseract.js). Both produce Spans in the same shape as before: text plus a 0-1 box with a top-left origin. We chose this over keeping PaddleOCR and opendataloader-pdf in a container function, which needed a second Vercel project, a shared token, a Docker image that does not build on Apple Silicon and a beta runtime, and over running that same parser in a Vercel Sandbox, which would add a VM start to every parse.

Tesseract reads a form row as one line, so a line is split into one Span per column wherever the gap between words is wider than the text is tall. That keeps each value's box tight, as PaddleOCR's were, and drops border characters such as `|` that OCR reads from ruled boxes.

## Considered Options

- **PaddleOCR's models in Node through onnxruntime-node**: the same models as before, so the same accuracy, but a native dependency of about 50 MB in the function bundle. Kept as the fallback if Tesseract misreads real documents.
- **Vercel Sandbox running the old Python parser**: no change in quality, but a VM start and dependency setup on every parse.
- **The language model as the OCR engine**: still rejected; its coordinates cannot be verified (ADR 0001).

## Consequences

- One Vercel project and no `PARSER_URL` or `PARSER_TOKEN`. Local development needs only `pnpm dev`.
- A scanned PDF is OCR'd from the page images stored with each preset pack rather than rendered in the function. Accepting uploaded scans later means rendering pages first.
- Tesseract downloads its English language data on first use and caches it in the function's `/tmp`, so a cold function makes one extra request.
- On the synthetic packs Tesseract is about ten times faster than PaddleOCR on CPU (under a second a page) and still reads the passport's machine-readable zone, but it is less accurate on noisy scans. `parsers.test.ts` holds the values each pack must yield.
