/**
 * Writes `fixtures/name-extraction/manifest.json` (ids, splits, pages and
 * Answer key sizes of the Name Extraction Corpus) and renders three sample
 * Documents as text PDFs to `public/name-extraction/samples/<id>.pdf`, one
 * PDF page per Document page. Deterministic: re-running changes nothing.
 *
 *   node --experimental-strip-types scripts/render-name-extraction-corpus.mts
 *
 * The PDF writer is hand-written (Helvetica, WinAnsiEncoding, Flate-compressed
 * content streams) so the samples need no new dependency.
 */
import { mkdir, writeFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

type Resolve = (
  specifier: string,
  context: unknown,
  next: (specifier: string, context: unknown) => unknown,
) => unknown;
// Not yet in the installed @types/node.
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve: Resolve }): void;
};

// The domain modules import each other without extensions, the way the app
// bundler expects; let Node find the .ts file.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw error;
    }
  },
});

const CORPUS_MODULE = "../src/features/name-extraction/domain/corpus/index.ts";
const { CORPUS, corpusCards, generateDocument } = (await import(
  CORPUS_MODULE
)) as typeof import("../src/features/name-extraction/domain/corpus");

const ROOT = join(import.meta.dirname, "..");
const MANIFEST = join(ROOT, "fixtures/name-extraction/manifest.json");
const SAMPLES_DIR = join(ROOT, "public/name-extraction/samples");
/** One short, one long, one 500-page Document, all from the test split. */
const SAMPLES = ["ne-te-01", "ne-te-04", "ne-te-06"];

// A tiny PDF writer ---------------------------------------------------------------------

const WIN_ANSI: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  "„": 0x84,
  "…": 0x85,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "™": 0x99,
};

/** A PDF string literal in WinAnsi bytes; characters outside it print as "?". */
function pdfString(text: string): Buffer {
  const bytes: number[] = [0x28];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0x3f;
    let byte =
      WIN_ANSI[char] ??
      (code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : 0x3f);
    if (byte < 0x20) byte = 0x20;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) bytes.push(0x5c);
    bytes.push(byte);
  }
  bytes.push(0x29);
  return Buffer.from(bytes);
}

const FONT_SIZE = 7.5;
const LEADING = 9;
const PAGE = { width: 595, height: 842, margin: 36 };

function pageContent(text: string): Buffer {
  const parts: Buffer[] = [
    Buffer.from(
      `BT /F1 ${FONT_SIZE} Tf ${LEADING} TL ${PAGE.margin} ${PAGE.height - PAGE.margin} Td\n`,
      "latin1",
    ),
  ];
  for (const line of text.split("\n")) {
    parts.push(pdfString(line), Buffer.from(" Tj T*\n", "latin1"));
  }
  parts.push(Buffer.from("ET\n", "latin1"));
  return Buffer.concat(parts);
}

function writePdf(title: string, pages: string[]): Buffer {
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Buffer | string) => {
    const buffer =
      typeof data === "string" ? Buffer.from(data, "latin1") : data;
    chunks.push(buffer);
    length += buffer.length;
  };
  const object = (id: number, body: Buffer | string, stream?: Buffer) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    push(body);
    if (stream) {
      push("\nstream\n");
      push(stream);
      push("\nendstream");
    }
    push("\nendobj\n");
  };

  const pageIds = pages.map((_, i) => 5 + i * 2);
  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
  );
  object(
    3,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  object(
    4,
    Buffer.concat([
      Buffer.from("<< /Title ", "latin1"),
      pdfString(title),
      Buffer.from(" /Producer (render-name-extraction-corpus) >>", "latin1"),
    ]),
  );
  pages.forEach((text, i) => {
    const pageId = pageIds[i];
    const stream = deflateSync(pageContent(text));
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
    );
    object(
      pageId + 1,
      `<< /Length ${stream.length} /Filter /FlateDecode >>`,
      stream,
    );
  });
  const count = 5 + pages.length * 2;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++)
    push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(
    `trailer\n<< /Size ${count} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  return Buffer.concat(chunks);
}

// Manifest and samples ------------------------------------------------------------------

const cards = new Map(corpusCards().map((card) => [card.id, card]));
const documents = CORPUS.map((entry) => ({
  id: entry.id,
  title: entry.title,
  genre: entry.genre,
  split: entry.split,
  pages: entry.pages,
  seed: entry.seed,
  expectedNames: cards.get(entry.id)?.expectedNames ?? 0,
}));
const splits = Object.fromEntries(
  ["train", "validation", "test"].map((split) => {
    const docs = documents.filter((d) => d.split === split);
    return [
      split,
      {
        documents: docs.length,
        pages: docs.reduce((n, d) => n + d.pages, 0),
        expectedNames: docs.reduce((n, d) => n + d.expectedNames, 0),
      },
    ];
  }),
);

await mkdir(SAMPLES_DIR, { recursive: true });
for (const id of SAMPLES) {
  const { document } = generateDocument(id);
  const pdf = writePdf(`${document.title} (SPECIMEN)`, document.pages);
  await writeFile(join(SAMPLES_DIR, `${id}.pdf`), pdf);
  console.log(
    `public/name-extraction/samples/${id}.pdf  ${document.pages.length} pages  ${(pdf.length / 1024).toFixed(0)} KB`,
  );
}

const manifest = {
  about:
    "Synthetic AML Documents for the Name Extraction demo, generated from a seed by src/features/name-extraction/domain/corpus. Fictional Republic of Meridia; every page says SPECIMEN. Written by scripts/render-name-extraction-corpus.mts; do not edit by hand.",
  splits,
  samples: SAMPLES.map((id) => `public/name-extraction/samples/${id}.pdf`),
  documents,
};
await mkdir(join(ROOT, "fixtures/name-extraction"), { recursive: true });
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `fixtures/name-extraction/manifest.json  ${documents.length} documents`,
);
