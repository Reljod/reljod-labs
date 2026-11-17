export type PdfSpan = {
  page: number;
  text: string;
  box: { y0: number; y1: number };
};

/**
 * A PDF's lines as text, one `[page N]` mark per page. A gap taller than the
 * line above it becomes a blank line, so a paragraph of the PDF stays one
 * paragraph for the splitter.
 */
export function pdfText(spans: PdfSpan[]): string {
  const pages = new Map<number, PdfSpan[]>();
  for (const span of spans) {
    const list = pages.get(span.page) ?? [];
    list.push(span);
    pages.set(span.page, list);
  }
  return [...pages.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page, lines]) => {
      let out = `[page ${page}]\n`;
      let previous: PdfSpan | null = null;
      for (const line of lines) {
        if (previous) {
          const height = Math.max(0.001, previous.box.y1 - previous.box.y0);
          const gap = line.box.y0 - previous.box.y1;
          out += gap > height * 0.9 ? "\n\n" : "\n";
        }
        out += line.text;
        previous = line;
      }
      return out;
    })
    .join("\n\n");
}
