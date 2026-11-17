import "server-only";
import { readDocx, readXlsx } from "@/features/client-manager/domain/office";
import { parseDocument } from "@/features/document-compliance/server/parsers";
import type { SourceKind } from "../../domain/knowledge";
import { pdfText } from "../../domain/knowledge/pdf-text";
import { MAX_TEXT_CHARS } from "../../domain/knowledge/split";

/**
 * Turns a stored file into text, inside the app (no OCR: a scanned PDF has no
 * text layer and is refused with a message that says so). Office files are
 * read as plain XML by `readXlsx` and `readDocx`, which evaluate nothing.
 */

const clip = (text: string) =>
  text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;

export class UnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadableError";
  }
}

/** The text of a file, or an UnreadableError whose message says why in words a person can act on. */
export async function extractText(
  kind: SourceKind,
  bytes: Uint8Array,
): Promise<string> {
  try {
    switch (kind) {
      case "pdf": {
        const parsed = await parseDocument({
          file: bytes,
          sourceFormat: "pdf_digital",
          pageImages: [],
        });
        const text = pdfText(parsed.spans);
        if (text.replace(/\[page \d+\]/g, "").trim().length < 40) {
          throw new UnreadableError(
            "This PDF has no text layer (a scan?). Upload a digital copy, or paste its text.",
          );
        }
        return clip(text);
      }
      case "sheet": {
        const sheets = readXlsx(bytes);
        if (sheets.length === 0) {
          throw new UnreadableError("This workbook has no sheets with cells.");
        }
        return clip(
          sheets
            .map(
              (sheet) =>
                `## Sheet: ${sheet.name} (${sheet.rows} rows)\n${sheet.csv}`,
            )
            .join("\n\n"),
        );
      }
      case "doc":
        return clip(readDocx(bytes));
      default:
        return clip(new TextDecoder("utf-8").decode(bytes));
    }
  } catch (error) {
    if (error instanceof UnreadableError) throw error;
    throw new UnreadableError(
      `This ${kind === "sheet" ? "workbook" : kind === "doc" ? "document" : "file"} could not be read. Is it a damaged or protected file?`,
    );
  }
}
