import "server-only";
import { tmpdir } from "node:os";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { createWorker } from "tesseract.js";
import type { Box, SourceFormat, Span } from "../domain/types";

export type ParserName = "tesseract" | "pdfjs";

export type ParsedDocument = {
  parser: ParserName;
  pageCount: number;
  spans: Span[];
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** A box in image pixels (top-left origin), normalised by the image size. */
function pixelBox(box: Box, size: { width: number; height: number }): Box {
  return {
    x0: clamp(box.x0 / size.width),
    y0: clamp(box.y0 / size.height),
    x1: clamp(box.x1 / size.width),
    y1: clamp(box.y1 / size.height),
  };
}

/** Width and height from a PNG or JPEG header, without decoding the image. */
export function imageSize(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0) === 0x89504e47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: walk the segments to the start-of-frame marker.
  let offset = 2;
  while (offset < data.length) {
    const marker = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if (
      marker >= 0xffc0 &&
      marker <= 0xffcf &&
      ![0xffc4, 0xffc8, 0xffcc].includes(marker)
    ) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw new Error("Unsupported image: expected PNG or JPEG");
}

type OcrWord = {
  text: string;
  confidence: number;
  bbox: Box;
};

/** A real word, not a table rule or box border OCR read as `|` or `_`. */
const isWord = (word: OcrWord) => /[\p{L}\p{N}<]/u.test(word.text);

/**
 * Splits an OCR line wherever the gap between words is wider than the text is
 * tall: Tesseract reads a form row ("MERIDIAN  14 MAR 1991  F") as one line,
 * but each column is its own value and deserves its own tight box.
 */
export function columns(words: OcrWord[]): OcrWord[][] {
  const kept = words.filter(isWord);
  const groups: OcrWord[][] = [];
  for (const word of kept) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    const height = word.bbox.y1 - word.bbox.y0;
    if (group && previous && word.bbox.x0 - previous.bbox.x1 <= height * 1.2) {
      group.push(word);
    } else {
      groups.push([word]);
    }
  }
  return groups;
}

/** OCR one page image into Spans, one per column of each line, with their confidence. */
async function ocrPage(image: Uint8Array, page: number): Promise<Span[]> {
  const size = imageSize(image);
  // Vercel functions can only write to /tmp, where the language data is cached.
  const worker = await createWorker("eng", 1, { cachePath: tmpdir() });
  try {
    const { data } = await worker.recognize(
      Buffer.from(image),
      {},
      { blocks: true },
    );
    const lines = (data.blocks ?? []).flatMap((block) =>
      block.paragraphs.flatMap((paragraph) => paragraph.lines),
    );
    return lines
      .flatMap((line) => columns(line.words))
      .map((words, index) => ({
        ref: `p${page}-s${index + 1}`,
        page,
        text: words.map((word) => word.text).join(" "),
        granularity: "line" as const,
        box: pixelBox(
          {
            x0: Math.min(...words.map((word) => word.bbox.x0)),
            y0: Math.min(...words.map((word) => word.bbox.y0)),
            x1: Math.max(...words.map((word) => word.bbox.x1)),
            y1: Math.max(...words.map((word) => word.bbox.y1)),
          },
          size,
        ),
        confidence: Math.min(...words.map((word) => word.confidence)) / 100,
      }));
  } finally {
    await worker.terminate();
  }
}

/** Text items that share a baseline and sit close together read as one line. */
function joinLines(items: TextItem[]) {
  const lines: {
    text: string;
    left: number;
    right: number;
    bottom: number;
    top: number;
  }[] = [];
  for (const item of items) {
    if (item.str.trim() === "") continue;
    const left = item.transform[4];
    const bottom = item.transform[5];
    const top = bottom + item.height;
    const right = left + item.width;
    const line = lines.at(-1);
    const sameLine =
      line &&
      Math.abs(line.bottom - bottom) < item.height * 0.3 &&
      left - line.right < item.height * 1.5;
    if (line && sameLine) {
      const gap = left - line.right > item.height * 0.15 ? " " : "";
      line.text += gap + item.str;
      line.right = Math.max(line.right, right);
      line.top = Math.max(line.top, top);
    } else {
      lines.push({ text: item.str, left, right, bottom, top });
    }
  }
  return lines;
}

/** A born-digital PDF's text layer as line Spans; PDF points are flipped to a top-left origin. */
async function parseDigitalPdf(file: Uint8Array): Promise<ParsedDocument> {
  // pdf.js loads its worker by a computed path that file tracing cannot see,
  // so it was missing on Vercel. Registered on globalThis, the worker is
  // imported like any module and runs in-process.
  const [{ getDocument }, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ]);
  Object.assign(globalThis, { pdfjsWorker: worker });
  const loading = getDocument({ data: new Uint8Array(file) });
  const pdf = await loading.promise;
  try {
    const spans: Span[] = [];
    for (let page = 1; page <= pdf.numPages; page++) {
      const pdfPage = await pdf.getPage(page);
      const { width, height } = pdfPage.getViewport({ scale: 1 });
      const content = await pdfPage.getTextContent();
      const items = content.items.filter(
        (item): item is TextItem => "str" in item,
      );
      joinLines(items).forEach((line, index) => {
        spans.push({
          ref: `p${page}-s${index + 1}`,
          page,
          text: line.text.trim(),
          granularity: "line",
          box: {
            x0: clamp(line.left / width),
            y0: clamp((height - line.top) / height),
            x1: clamp(line.right / width),
            y1: clamp((height - line.bottom) / height),
          },
          confidence: null,
        });
      });
    }
    return { parser: "pdfjs", pageCount: pdf.numPages, spans };
  } finally {
    await loading.destroy();
  }
}

/**
 * Turns a Document into Spans inside the app (ADR 0004): the PDF text layer
 * when there is one, OCR of the page images otherwise. Scanned PDFs are read
 * from their page images, which every preset pack stores alongside the file.
 */
export async function parseDocument(input: {
  file: Uint8Array;
  sourceFormat: SourceFormat;
  pageImages: Uint8Array[];
}): Promise<ParsedDocument> {
  if (input.sourceFormat === "pdf_digital") return parseDigitalPdf(input.file);

  const images =
    input.sourceFormat === "image" ? [input.file] : input.pageImages;
  const spans: Span[] = [];
  for (const [index, image] of images.entries()) {
    spans.push(...(await ocrPage(image, index + 1)));
  }
  return { parser: "tesseract", pageCount: images.length, spans };
}
