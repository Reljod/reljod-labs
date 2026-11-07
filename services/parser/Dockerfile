# Parser service for document compliance checks (ADR 0002).
# Python for PaddleOCR, plus a JRE because opendataloader-pdf runs a Java engine.
FROM python:3.13-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-21-jre-headless libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
# Download the OCR models at build time so cold starts don't fetch them.
RUN python -c "from app.parsers import ocr_engine; ocr_engine()"

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
