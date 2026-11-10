import "server-only";
import { parseDocument } from "@/features/document-compliance/server/parsers";
import type { SourceKind } from "../domain/events";
import { readCsv, readDocx, readXlsx } from "../domain/office";
import { download } from "./storage";

/** The most text one Source hands the extractor. */
export const MAX_SOURCE_CHARS = 40_000;

export const ACCEPTED = {
  pdf: ["application/pdf"],
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  sheet: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
  ],
  doc: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  text: ["text/plain", "text/markdown"],
} as const;

/** What kind of Source a file is, from its type and then its extension. */
export function kindOf(name: string, mediaType: string): SourceKind | null {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (mediaType === "application/pdf" || extension === "pdf") return "pdf";
  if (
    mediaType.startsWith("image/") &&
    ["jpg", "jpeg", "png", "webp", "gif"].includes(extension)
  ) {
    return "image";
  }
  if (["xlsx", "csv"].includes(extension)) return "sheet";
  if (extension === "docx") return "doc";
  if (["txt", "md", "markdown", "eml"].includes(extension)) return "text";
  return null;
}

export function mediaTypeFor(kind: SourceKind, name: string, given: string) {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (kind === "pdf") return "application/pdf";
  if (kind === "image") {
    return given.startsWith("image/")
      ? given
      : extension === "png"
        ? "image/png"
        : "image/jpeg";
  }
  if (kind === "sheet")
    return extension === "csv" ? "text/csv" : ACCEPTED.sheet[0];
  if (kind === "doc") return ACCEPTED.doc[0];
  return "text/plain";
}

export type GatheredSource = {
  id: string;
  name: string;
  kind: SourceKind;
  mediaType: string;
  storagePath: string | null;
  /** null when the model must read the file itself: images and scanned PDFs. */
  text: string | null;
};

const clip = (text: string) =>
  text.length > MAX_SOURCE_CHARS
    ? `${text.slice(0, MAX_SOURCE_CHARS)}\n[…truncated]`
    : text;

/** Turns one stored file into the text the extractor reads. */
export async function readSource(source: {
  kind: SourceKind;
  name: string;
  storagePath: string | null;
  text: string | null;
}): Promise<string | null> {
  if (source.kind === "note" || !source.storagePath)
    return source.text ? clip(source.text) : null;
  const bytes = await download(source.storagePath);
  switch (source.kind) {
    case "image":
      return null;
    case "pdf": {
      const parsed = await parseDocument({
        file: bytes,
        sourceFormat: "pdf_digital",
        pageImages: [],
      }).catch(() => null);
      if (!parsed) return null;
      const pages = new Map<number, string[]>();
      for (const span of parsed.spans) {
        const lines =
          pages.get(span.page) ?? pages.set(span.page, []).get(span.page);
        lines?.push(span.text);
      }
      const text = [...pages.entries()]
        .sort(([a], [b]) => a - b)
        .map(([page, lines]) => `[page ${page}]\n${lines.join(" ")}`)
        .join("\n\n");
      // A scan has no text layer; the model reads the pages instead.
      return text.replace(/\[page \d+\]/g, "").trim().length < 40
        ? null
        : clip(text);
    }
    case "sheet": {
      if (source.name.toLowerCase().endsWith(".csv")) {
        return clip(readCsv(new TextDecoder().decode(bytes)));
      }
      return clip(
        readXlsx(bytes)
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
      return clip(new TextDecoder().decode(bytes));
  }
}
