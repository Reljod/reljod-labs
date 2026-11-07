# Parser service

Turns a Document into Spans (text plus a box normalised to 0-1, top-left origin) for the document compliance demo. See ADR 0002 for why it is a separate container.

| `source_format` | Parser | Span granularity |
| --- | --- | --- |
| `image` | PaddleOCR, PP-OCRv5 mobile models, CPU | line |
| `pdf_scanned` | pages rendered at 150 DPI, then PaddleOCR | line |
| `pdf_digital` | opendataloader-pdf (needs Java 11+) | element (paragraph) |

## API

- `GET /health`
- `POST /parse` with `{"url": "<signed URL>", "source_format": "image" | "pdf_digital" | "pdf_scanned"}` and `Authorization: Bearer $PARSER_TOKEN` when `PARSER_TOKEN` is set. Returns `{parser, page_count, spans}`.

## Run locally

With Docker (same image Vercel runs), from the repo root:

```bash
docker compose up --build parser
```

Without Docker (needs Python 3.11+ and Java 11+):

```bash
python3 -m venv services/parser/.venv
services/parser/.venv/bin/pip install -r services/parser/requirements-dev.txt
cd services/parser && .venv/bin/uvicorn app.main:app --port 8000
```

## Test

```bash
cd services/parser && .venv/bin/python -m pytest -q
```

`tests/test_parsers.py` runs the real parsers on the synthetic packs. It is local and free; the first run downloads the OCR models.

## Deploy

Deploy this folder as its own Vercel project using a container function ([Running Docker on Vercel](https://vercel.com/kb/guide/docker), beta). Set `PARSER_TOKEN` there and the same value plus `PARSER_URL` in the Next.js project.
