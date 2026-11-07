"""Parser service: fetches a Document by signed URL and returns its Spans."""

import os
import tempfile
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from .parsers import parse_digital_pdf, parse_image, parse_scanned_pdf
from .spans import Span

app = FastAPI(title="Document compliance parser")

PARSERS = {
    "image": ("paddleocr", parse_image),
    "pdf_scanned": ("paddleocr", parse_scanned_pdf),
    "pdf_digital": ("opendataloader_pdf", parse_digital_pdf),
}

# PaddleOCR skips files whose extension it doesn't recognise, so keep the real one.
SUFFIXES = {"image/png": ".png", "image/jpeg": ".jpg", "application/pdf": ".pdf"}


def suffix_for(content_type: str, source_format: str) -> str:
    media_type = content_type.split(";")[0].strip().lower()
    if media_type in SUFFIXES:
        return SUFFIXES[media_type]
    return ".jpg" if source_format == "image" else ".pdf"


class ParseRequest(BaseModel):
    url: str
    source_format: Literal["image", "pdf_digital", "pdf_scanned"]


class ParseResponse(BaseModel):
    parser: Literal["paddleocr", "opendataloader_pdf"]
    page_count: int
    spans: list[Span]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/parse")
def parse(request: ParseRequest, authorization: str = Header(default="")) -> ParseResponse:
    token = os.environ.get("PARSER_TOKEN", "")
    if token and authorization != f"Bearer {token}":
        raise HTTPException(status_code=401, detail="Invalid parser token")

    parser_name, parse_file = PARSERS[request.source_format]
    response = httpx.get(request.url, timeout=30, follow_redirects=True)
    if response.status_code != 200:
        raise HTTPException(status_code=422, detail=f"Could not fetch document ({response.status_code})")

    suffix = suffix_for(response.headers.get("content-type", ""), request.source_format)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"document{suffix}"
        path.write_bytes(response.content)
        page_count, spans = parse_file(path)
    return ParseResponse(parser=parser_name, page_count=page_count, spans=spans)
