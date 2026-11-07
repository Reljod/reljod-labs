-- Parsing moved into the app (ADR 0004): Tesseract OCR and the pdf.js text
-- layer replace PaddleOCR and opendataloader-pdf. Old rows keep their values.

alter table document_compliance.documents
  drop constraint documents_parser_check;

alter table document_compliance.documents
  add constraint documents_parser_check
  check (parser in ('paddleocr', 'opendataloader_pdf', 'tesseract', 'pdfjs'));
