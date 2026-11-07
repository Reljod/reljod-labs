# Run parsing in a container Vercel Function

_Superseded by ADR 0004: parsing now runs inside the app with Tesseract and pdf.js._

opendataloader-pdf needs a Java runtime and PaddleOCR needs Python, and neither runs in the Next.js app's Node functions. Vercel is the only compute available to us, so parsing lives in one Docker image (Python plus a JRE) deployed as a container Vercel Function in its own Vercel project. The Next.js app calls it server to server with a short-lived signed Supabase Storage URL rather than the file itself, to stay under Vercel's 4.5 MB request body limit, and gets back Spans in one shape regardless of which parser ran.

## Considered Options

- **A Python Vercel Function running RapidOCR**: avoids the container beta, but has no Java, so opendataloader-pdf would have to be replaced. Kept as the fallback if container functions prove unreliable.
- **Using the language model as the OCR engine**: rejected because its coordinates can't be verified, which breaks traceability (see ADR 0001).
- **Hosting outside Vercel** (Cloud Run, Fly, GPU serverless): ruled out by the Vercel-only constraint.

## Consequences

- The parser is designed for Hobby limits (2 GB memory, 1 vCPU, 300 s), so PaddleOCR uses the lighter PP-OCR models and runs on CPU.
- Container functions are in beta on Vercel; a breaking change there means falling back to the Python-function option above.
