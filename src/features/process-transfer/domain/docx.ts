import { strToU8, zipSync } from "fflate";
import type {
  DocumentBlock,
  DocumentMeta,
  DocumentSection,
  StepBlock,
  TableBlock,
} from "./document";
import { documentDate, documentSections, documentStatus } from "./document";
import type { Frame, Frames } from "./frames";
import { frameKey } from "./frames";
import type { Process } from "./process";

/*
 * The Workflow document as a DOCX, written by hand as WordprocessingML and
 * zipped with fflate. Pure: no DOM, no Node APIs, so the browser builds it
 * from the Frames it captured (Frames are never uploaded) and tests build it
 * in Node. It renders `documentSections`, the same data the page preview
 * shows.
 *
 * Element order inside w:pPr, w:rPr, w:tblPr and w:sectPr follows the
 * schema's sequence; Word repairs (or refuses) a file that gets it wrong
 * even where LibreOffice does not care.
 */

// Page geometry, in twentieths of a point (twips). A4, 2 cm side margins.
const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const MARGIN_SIDE = 1134;
const MARGIN_TOP = 1418;
const MARGIN_BOTTOM = 1304;
const TEXT_WIDTH = PAGE_WIDTH - 2 * MARGIN_SIDE;

/** English Metric Units per twip (914400 per inch, 1440 twips per inch). */
const EMU_PER_TWIP = 635;
const MAX_IMAGE_WIDTH = TEXT_WIDTH * EMU_PER_TWIP;
/**
 * 7 cm. A step's heading, instruction and screenshot are kept on one page;
 * at this height two such steps usually share a page, so keeping them
 * together does not leave half the page empty.
 */
const MAX_IMAGE_HEIGHT = 2520000;

// The site's palette, used sparingly: headings, rules and two callouts.
const INK = "14213D";
const INK_MUTED = "4A4F5B";
const FEDERAL_BLUE = "1D4E89";
const MARBLE = "F5F1E8";
const LIMESTONE = "E4DCCB";
const STONE = "8A8478";
const BRASS = "D9A84E";
const SEAL_RED = "B23A2B";
const WARNING_FILL = "FBEDEA";
const NOTE_FILL = "FBF5E8";

const FONT = "Calibri";

// Numbering instances (w:numId). Numbered lists get one each, from LIST_BASE up.
const NUM_BULLET = 1;
const NUM_HEADING = 2;
const NUM_STEP = 3;
const LIST_BASE = 4;

const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
  officeRel:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
};

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export type DocxOptions = { frames: Frames; meta: DocumentMeta };

/** The Workflow document for `process`, as the bytes of a .docx file. */
export function buildDocx(process: Process, options: DocxOptions): Uint8Array {
  const { meta } = options;
  const sections = documentSections(process, meta);
  const writer = new BodyWriter(options.frames);
  const body = sections.map((section) => writer.section(section)).join("");
  const title = sections[0]?.heading ?? process.title;

  const documentXml = `${XML_HEAD}<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}"><w:body>${body}${sectionProperties()}</w:body></w:document>`;

  const docRels = [
    rel("rId1", "styles", "styles.xml"),
    rel("rId2", "numbering", "numbering.xml"),
    rel("rId3", "settings", "settings.xml"),
    rel("rId4", "header", "header1.xml"),
    rel("rId5", "footer", "footer1.xml"),
    ...writer.media.map((item) => rel(item.rId, "image", `media/${item.name}`)),
  ];

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes(writer.media)),
    "_rels/.rels": strToU8(
      relationships([
        rel("rId1", "officeDocument", "word/document.xml"),
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`,
        rel("rId3", "extended-properties", "docProps/app.xml"),
      ]),
    ),
    "docProps/core.xml": strToU8(coreProperties(title, meta)),
    "docProps/app.xml": strToU8(appProperties()),
    "word/document.xml": strToU8(documentXml),
    "word/_rels/document.xml.rels": strToU8(relationships(docRels)),
    "word/styles.xml": strToU8(STYLES_XML),
    "word/numbering.xml": strToU8(numberingXml(writer.numberedLists)),
    "word/settings.xml": strToU8(SETTINGS_XML),
    "word/header1.xml": strToU8(headerXml(title, meta)),
    "word/footer1.xml": strToU8(footerXml(meta)),
  };
  for (const item of writer.media) {
    files[`word/media/${item.name}`] = item.frame.bytes;
  }

  // A fixed timestamp keeps the zip byte-for-byte the same for the same input.
  const created = new Date(meta.generatedAt);
  const mtime =
    Number.isNaN(created.getTime()) || created.getUTCFullYear() < 1980
      ? new Date(Date.UTC(1980, 0, 1))
      : created;
  return zipSync(files, { level: 6, mtime });
}

// XML text -------------------------------------------------------------------

/**
 * Text as XML 1.0 allows it: control characters other than tab and newline
 * are dropped and lone surrogates become U+FFFD, so a stray byte from a
 * transcript cannot make Word reject the file. Emoji (paired surrogates) stay.
 */
export function xmlSafe(text: string): string {
  let out = "";
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[index] + text[index + 1];
        index++;
      } else {
        out += "�";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += "�";
    } else if (
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      code === 0xfffe ||
      code === 0xffff
    ) {
      // dropped
    } else {
      out += text[index];
    }
  }
  return out;
}

export function escapeXml(text: string): string {
  return xmlSafe(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Escaped for an attribute value, on one line. */
function attr(text: string): string {
  return escapeXml(text.replace(/[\r\n\t]+/g, " ").trim());
}

type RunStyle = {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: number;
};

function runProps(style: RunStyle): string {
  const parts = [
    style.bold ? "<w:b/><w:bCs/>" : "",
    style.italic ? "<w:i/><w:iCs/>" : "",
    style.color ? `<w:color w:val="${style.color}"/>` : "",
    style.size
      ? `<w:sz w:val="${style.size}"/><w:szCs w:val="${style.size}"/>`
      : "",
  ].join("");
  return parts ? `<w:rPr>${parts}</w:rPr>` : "";
}

/** A run of text; newlines become line breaks and tabs become tabs. */
function run(text: string, style: RunStyle = {}): string {
  const props = runProps(style);
  const lines = xmlSafe(text).replace(/\r\n?/g, "\n").split("\n");
  const content = lines
    .map((line, index) => {
      const pieces = line
        .split("\t")
        .map((piece) =>
          piece ? `<w:t xml:space="preserve">${escapeXml(piece)}</w:t>` : "",
        )
        .join("<w:tab/>");
      return (index > 0 ? "<w:br/>" : "") + pieces;
    })
    .join("");
  return `<w:r>${props}${content}</w:r>`;
}

type ParagraphProps = {
  style?: string;
  keepNext?: boolean;
  keepLines?: boolean;
  num?: { id: number; level?: number };
  spacingAfter?: number;
};

function paragraph(content: string, props: ParagraphProps = {}): string {
  const pPr = [
    props.style ? `<w:pStyle w:val="${props.style}"/>` : "",
    props.keepNext ? "<w:keepNext/>" : "",
    props.keepLines ? "<w:keepLines/>" : "",
    props.num
      ? `<w:numPr><w:ilvl w:val="${props.num.level ?? 0}"/><w:numId w:val="${props.num.id}"/></w:numPr>`
      : "",
    props.spacingAfter !== undefined
      ? `<w:spacing w:after="${props.spacingAfter}"/>`
      : "",
  ].join("");
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${content}</w:p>`;
}

// Body -----------------------------------------------------------------------

type Media = { key: string; name: string; rId: string; frame: Frame };

type Cell = { text: string; bold?: boolean; fill?: string };

/** Walks the sections once, collecting the images and list instances it needs. */
class BodyWriter {
  media: Media[] = [];
  numberedLists = 0;
  private drawingId = 0;
  private figure = 0;

  constructor(private frames: Frames) {}

  section(section: DocumentSection): string {
    let out = "";
    if (section.id === "cover") {
      if (section.eyebrow) {
        out += paragraph(run(section.eyebrow), { style: "Subtitle" });
      }
      out += paragraph(run(section.heading), { style: "Title" });
    } else {
      out += paragraph(run(section.heading), {
        style: "Heading1",
        num: section.number !== null ? { id: NUM_HEADING } : undefined,
      });
    }
    for (const block of section.blocks) out += this.block(block);
    return out;
  }

  private block(block: DocumentBlock): string {
    switch (block.kind) {
      case "paragraph":
        return paragraph(run(block.text), {
          style: block.muted ? "Muted" : undefined,
        });
      case "subheading":
        return paragraph(run(block.text), { style: "Heading2" });
      case "bullets":
        return block.items
          .map((item) =>
            paragraph(run(item), {
              style: "ListParagraph",
              num: { id: NUM_BULLET },
            }),
          )
          .join("");
      case "numbered": {
        const id = LIST_BASE + this.numberedLists;
        this.numberedLists++;
        return block.items
          .map((item) =>
            paragraph(run(item), { style: "ListParagraph", num: { id } }),
          )
          .join("");
      }
      case "keyValue":
        return table(
          widths([0.3, 0.7]),
          block.rows.map((row) => [
            { text: row.key, bold: true, fill: MARBLE },
            { text: row.value },
          ]),
          { header: false, label: "Details" },
        );
      case "table":
        return this.table(block);
      case "step":
        return this.step(block);
      case "callout":
        return paragraph(
          `${run(`${block.title}: `, { bold: true, color: block.tone === "warning" ? SEAL_RED : INK })}${run(block.text)}`,
          { style: block.tone === "warning" ? "Warning" : "Note" },
        );
    }
  }

  private table(block: TableBlock): string {
    return table(
      widths(block.widths),
      [
        block.columns.map((text) => ({ text, bold: true, fill: LIMESTONE })),
        ...block.rows.map((row) =>
          block.columns.map((_, index) => ({ text: row[index] ?? "" })),
        ),
      ],
      { header: true, label: block.columns.join(", ") },
    );
  }

  private step(step: StepBlock): string {
    let out = paragraph(run(step.title), {
      style: "StepHeading",
      num: { id: NUM_STEP },
    });

    const meta: string[] = [
      run("Who ", { color: INK_MUTED }) +
        run(step.actor || "Not named", { bold: true }),
    ];
    if (step.system) {
      meta.push(
        run("Where ", { color: INK_MUTED }) + run(step.system, { bold: true }),
      );
    }
    if (step.time) {
      meta.push(
        run("In the recording ", { color: INK_MUTED }) +
          run(step.time, { bold: true }),
      );
    }
    out += paragraph(meta.join(run(" · ", { color: STONE })), {
      style: "StepMeta",
    });

    // Heading, meta line, instruction, screenshot and caption keep together
    // (a keepNext chain), so a screenshot never opens a page away from its
    // step. Details, the warning and the decision table come after it and
    // flow freely, which bounds the gap a page break can leave to that chain.
    const frame = step.at === null ? undefined : this.frames[frameKey(step.at)];
    const hasFigure =
      step.at !== null &&
      frame !== undefined &&
      frame.width > 0 &&
      frame.height > 0;
    const more =
      step.details.length > 0 ||
      step.warning !== null ||
      step.decision !== null;
    out += paragraph(run(step.action), {
      keepNext: hasFigure || more,
      keepLines: true,
    });

    if (hasFigure && frame && step.at !== null) {
      const media = this.addMedia(frameKey(step.at), frame);
      this.figure++;
      const alt = `Screen at ${step.time} in the recording, step ${step.number}: ${step.title}`;
      out += paragraph(this.picture(media, frame, alt), {
        style: "Figure",
        keepNext: true,
      });
      out += paragraph(
        run(
          `Figure ${this.figure}. Step ${step.number} at ${step.time} in the recording`,
        ),
        { style: "Caption" },
      );
    }

    for (const detail of step.details) {
      out += paragraph(run(detail), {
        style: "ListParagraph",
        num: { id: NUM_BULLET },
      });
    }

    if (step.warning) {
      out += paragraph(
        run("Watch out: ", { bold: true, color: SEAL_RED }) + run(step.warning),
        { style: "Warning" },
      );
    }

    if (step.decision) {
      out += paragraph(
        run("Decision: ", { color: FEDERAL_BLUE }) +
          run(step.decision.question),
        { style: "Heading3" },
      );
      out += table(
        widths([0.4, 0.6]),
        [
          [
            { text: "If", bold: true, fill: LIMESTONE },
            { text: "Then", bold: true, fill: LIMESTONE },
          ],
          ...step.decision.branches.map((branch) => [
            { text: branch.when },
            { text: branch.then },
          ]),
        ],
        { header: true, label: `Decision: ${step.decision.question}` },
      );
    }

    return out;
  }

  private addMedia(key: string, frame: Frame): Media {
    const existing = this.media.find((item) => item.key === key);
    if (existing) return existing;
    const index = this.media.length + 1;
    const media: Media = {
      key,
      name: `frame${index}.${frame.mime === "image/png" ? "png" : "jpeg"}`,
      rId: `rIdImg${index}`,
      frame,
    };
    this.media.push(media);
    return media;
  }

  /** A DrawingML inline picture, scaled to the text width, aspect kept. */
  private picture(media: Media, frame: Frame, alt: string): string {
    let cx = MAX_IMAGE_WIDTH;
    let cy = Math.round((cx * frame.height) / frame.width);
    if (cy > MAX_IMAGE_HEIGHT) {
      cy = MAX_IMAGE_HEIGHT;
      cx = Math.round((cy * frame.width) / frame.height);
    }
    this.drawingId++;
    const id = this.drawingId;
    const description = attr(alt);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Screenshot ${id}" descr="${description}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${media.name}" descr="${description}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${media.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="9525"><a:solidFill><a:srgbClr val="${STONE}"/></a:solidFill></a:ln></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
}

/** Relative widths to twips across the text width; the last column takes the rounding. */
function widths(relative: number[]): number[] {
  const total = relative.reduce((sum, value) => sum + value, 0) || 1;
  const out = relative.map((value) => Math.floor((value / total) * TEXT_WIDTH));
  out[out.length - 1] +=
    TEXT_WIDTH - out.reduce((sum, value) => sum + value, 0);
  return out;
}

const BORDER = `w:val="single" w:sz="4" w:space="0" w:color="${STONE}"`;

/**
 * A full-width table with fixed column widths. With `header`, the first row
 * repeats on every page the table runs onto. Rows never split across pages.
 * A small paragraph follows, because Word merges adjacent tables and a table
 * needs air before the next heading.
 */
function table(
  columnWidths: number[],
  rows: Cell[][],
  options: { header: boolean; label: string },
): string {
  const grid = columnWidths
    .map((width) => `<w:gridCol w:w="${width}"/>`)
    .join("");
  const body = rows
    .map((row, rowIndex) => {
      const isHeader = options.header && rowIndex === 0;
      const trPr = `<w:trPr><w:cantSplit/>${isHeader ? "<w:tblHeader/>" : ""}</w:trPr>`;
      const cells = row
        .map((cell, cellIndex) => {
          const fill = cell.fill
            ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.fill}"/>`
            : "";
          const content = cell.text.trim()
            ? run(cell.text, { bold: cell.bold })
            : "";
          return `<w:tc><w:tcPr><w:tcW w:w="${columnWidths[cellIndex]}" w:type="dxa"/>${fill}</w:tcPr>${paragraph(content, { style: "TableText", keepNext: isHeader })}</w:tc>`;
        })
        .join("");
      return `<w:tr>${trPr}${cells}</w:tr>`;
    })
    .join("");
  const total = columnWidths.reduce((sum, value) => sum + value, 0);
  const tblPr = `<w:tblPr><w:tblStyle w:val="ProcessTable"/><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders><w:top ${BORDER}/><w:left ${BORDER}/><w:bottom ${BORDER}/><w:right ${BORDER}/><w:insideH ${BORDER}/><w:insideV ${BORDER}/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:val="${options.header ? "0620" : "0600"}"/><w:tblCaption w:val="${attr(options.label)}"/></w:tblPr>`;
  return `<w:tbl>${tblPr}<w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>${paragraph("", { style: "TableSpacer" })}`;
}

function sectionProperties(): string {
  return `<w:sectPr><w:headerReference w:type="default" r:id="rId4"/><w:footerReference w:type="default" r:id="rId5"/><w:pgSz w:w="${PAGE_WIDTH}" w:h="${PAGE_HEIGHT}"/><w:pgMar w:top="${MARGIN_TOP}" w:right="${MARGIN_SIDE}" w:bottom="${MARGIN_BOTTOM}" w:left="${MARGIN_SIDE}" w:header="680" w:footer="567" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>`;
}

// Package parts --------------------------------------------------------------

function rel(id: string, type: string, target: string): string {
  return `<Relationship Id="${id}" Type="${NS.officeRel}/${type}" Target="${target}"/>`;
}

function relationships(items: string[]): string {
  return `${XML_HEAD}<Relationships xmlns="${NS.rel}">${items.join("")}</Relationships>`;
}

function contentTypes(media: Media[]): string {
  const main = "application/vnd.openxmlformats-officedocument.wordprocessingml";
  const override = (part: string, type: string) =>
    `<Override PartName="${part}" ContentType="${type}"/>`;
  const defaults = [
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `<Default Extension="xml" ContentType="application/xml"/>`,
  ];
  if (media.some((item) => item.name.endsWith(".jpeg"))) {
    defaults.push(`<Default Extension="jpeg" ContentType="image/jpeg"/>`);
  }
  if (media.some((item) => item.name.endsWith(".png"))) {
    defaults.push(`<Default Extension="png" ContentType="image/png"/>`);
  }
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join("")}${[
    override("/word/document.xml", `${main}.document.main+xml`),
    override("/word/styles.xml", `${main}.styles+xml`),
    override("/word/numbering.xml", `${main}.numbering+xml`),
    override("/word/settings.xml", `${main}.settings+xml`),
    override("/word/header1.xml", `${main}.header+xml`),
    override("/word/footer1.xml", `${main}.footer+xml`),
    override(
      "/docProps/core.xml",
      "application/vnd.openxmlformats-package.core-properties+xml",
    ),
    override(
      "/docProps/app.xml",
      "application/vnd.openxmlformats-officedocument.extended-properties+xml",
    ),
  ].join("")}</Types>`;
}

/** W3CDTF without milliseconds, which some readers reject. */
function w3cdtf(iso: string): string {
  const date = new Date(iso);
  const valid = Number.isNaN(date.getTime()) ? new Date(0) : date;
  return `${valid.toISOString().slice(0, 19)}Z`;
}

function coreProperties(title: string, meta: DocumentMeta): string {
  const when = w3cdtf(meta.generatedAt);
  return `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:subject>Workflow document</dc:subject><dc:creator>Process transfer</dc:creator><cp:keywords>workflow document; procedure; handover</cp:keywords><dc:description>${escapeXml(`Generated from the recording "${meta.recordingName}". ${documentStatus(meta)}.`)}</dc:description><cp:revision>1</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified></cp:coreProperties>`;
}

function appProperties(): string {
  return `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Reljod Labs Process transfer</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged></Properties>`;
}

function field(instruction: string, placeholder: string): string {
  return `<w:fldSimple w:instr=" ${instruction} \\* MERGEFORMAT ">${run(placeholder)}</w:fldSimple>`;
}

function headerXml(title: string, meta: DocumentMeta): string {
  const right = `Workflow document · ${meta.status === "approved" ? "Approved" : "Draft"}`;
  return `${XML_HEAD}<w:hdr xmlns:w="${NS.w}" xmlns:r="${NS.r}">${paragraph(
    `${run(title, { bold: true, color: INK })}${run(`\t${right}`)}`,
    { style: "Header" },
  )}</w:hdr>`;
}

function footerXml(meta: DocumentMeta): string {
  const left = `${meta.recordingName} · ${documentDate(meta.generatedAt)} · Version ${meta.version ?? "0.1"}`;
  return `${XML_HEAD}<w:ftr xmlns:w="${NS.w}" xmlns:r="${NS.r}">${paragraph(
    `${run(`${left}\tPage `)}${field("PAGE", "1")}${run(" of ")}${field("NUMPAGES", "1")}`,
    { style: "Footer" },
  )}</w:ftr>`;
}

// Numbering ------------------------------------------------------------------

function level(
  ilvl: number,
  format: string,
  text: string,
  options: {
    left: number;
    hanging: number;
    suffix?: "tab" | "space";
    rPr?: string;
  },
): string {
  return `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${format}"/>${options.suffix ? `<w:suff w:val="${options.suffix}"/>` : ""}<w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${options.left}" w:hanging="${options.hanging}"/></w:pPr>${options.rPr ? `<w:rPr>${options.rPr}</w:rPr>` : ""}</w:lvl>`;
}

/**
 * Four kinds of numbering: bullets, section headings ("1."), steps
 * ("Step 1:") and numbered lists. Each numbered list gets its own w:num with a
 * start override, so every list starts at 1.
 */
function numberingXml(numberedLists: number): string {
  const bulletFont = `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}"/><w:color w:val="${FEDERAL_BLUE}"/>`;
  const abstract = [
    `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${level(0, "bullet", "•", { left: 357, hanging: 357, rPr: bulletFont })}${level(1, "bullet", "–", { left: 714, hanging: 357, rPr: bulletFont })}</w:abstractNum>`,
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${level(0, "decimal", "%1.", { left: 0, hanging: 0, suffix: "space" })}</w:abstractNum>`,
    `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="singleLevel"/>${level(0, "decimal", "Step %1:", { left: 0, hanging: 0, suffix: "space", rPr: `<w:color w:val="${FEDERAL_BLUE}"/>` })}</w:abstractNum>`,
    `<w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="hybridMultilevel"/>${level(0, "decimal", "%1.", { left: 357, hanging: 357 })}</w:abstractNum>`,
  ];
  const nums = [
    `<w:num w:numId="${NUM_BULLET}"><w:abstractNumId w:val="0"/></w:num>`,
    `<w:num w:numId="${NUM_HEADING}"><w:abstractNumId w:val="1"/></w:num>`,
    `<w:num w:numId="${NUM_STEP}"><w:abstractNumId w:val="2"/></w:num>`,
  ];
  for (let index = 0; index < numberedLists; index++) {
    nums.push(
      `<w:num w:numId="${LIST_BASE + index}"><w:abstractNumId w:val="3"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`,
    );
  }
  return `${XML_HEAD}<w:numbering xmlns:w="${NS.w}">${abstract.join("")}${nums.join("")}</w:numbering>`;
}

// Styles and settings --------------------------------------------------------

const FONTS = `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>`;

function paragraphStyle(
  id: string,
  name: string,
  options: {
    basedOn?: string;
    next?: string;
    pPr?: string;
    rPr?: string;
    outline?: boolean;
  },
): string {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${options.basedOn ? `<w:basedOn w:val="${options.basedOn}"/>` : ""}${options.next ? `<w:next w:val="${options.next}"/>` : ""}<w:qFormat/>${options.pPr ? `<w:pPr>${options.pPr}</w:pPr>` : ""}${options.rPr ? `<w:rPr>${options.rPr}</w:rPr>` : ""}</w:style>`;
}

const STYLES_XML = `${XML_HEAD}<w:styles xmlns:w="${NS.w}"><w:docDefaults><w:rPrDefault><w:rPr>${FONTS}<w:color w:val="${INK}"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-GB" w:eastAsia="en-GB" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>${[
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`,
  `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>`,
  `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`,
  `<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>`,
  paragraphStyle("Title", "Title", {
    basedOn: "Normal",
    next: "Normal",
    pPr: `<w:keepNext/><w:spacing w:before="0" w:after="240" w:line="240" w:lineRule="auto"/><w:contextualSpacing/>`,
    rPr: `<w:b/><w:bCs/><w:color w:val="${INK}"/><w:kern w:val="28"/><w:sz w:val="52"/><w:szCs w:val="52"/>`,
  }),
  paragraphStyle("Subtitle", "Subtitle", {
    basedOn: "Normal",
    next: "Title",
    pPr: `<w:keepNext/><w:spacing w:before="0" w:after="60"/>`,
    rPr: `<w:b/><w:bCs/><w:caps/><w:color w:val="${FEDERAL_BLUE}"/><w:spacing w:val="30"/><w:sz w:val="18"/><w:szCs w:val="18"/>`,
  }),
  paragraphStyle("Heading1", "heading 1", {
    basedOn: "Normal",
    next: "Normal",
    pPr: `<w:keepNext/><w:keepLines/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${LIMESTONE}"/></w:pBdr><w:spacing w:before="400" w:after="160"/><w:outlineLvl w:val="0"/>`,
    rPr: `<w:b/><w:bCs/><w:color w:val="${FEDERAL_BLUE}"/><w:sz w:val="32"/><w:szCs w:val="32"/>`,
  }),
  paragraphStyle("Heading2", "heading 2", {
    basedOn: "Normal",
    next: "Normal",
    pPr: `<w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/>`,
    rPr: `<w:b/><w:bCs/><w:color w:val="${INK}"/><w:sz w:val="25"/><w:szCs w:val="25"/>`,
  }),
  paragraphStyle("Heading3", "heading 3", {
    basedOn: "Normal",
    next: "Normal",
    pPr: `<w:keepNext/><w:keepLines/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/>`,
    rPr: `<w:b/><w:bCs/><w:color w:val="${INK}"/><w:sz w:val="21"/><w:szCs w:val="21"/>`,
  }),
  paragraphStyle("StepHeading", "Step Heading", {
    basedOn: "Heading2",
    next: "StepMeta",
    pPr: `<w:keepNext/><w:keepLines/><w:pBdr><w:top w:val="single" w:sz="4" w:space="8" w:color="${LIMESTONE}"/></w:pBdr><w:spacing w:before="360" w:after="60"/><w:outlineLvl w:val="1"/>`,
  }),
  paragraphStyle("StepMeta", "Step Meta", {
    basedOn: "Normal",
    next: "Normal",
    pPr: `<w:keepNext/><w:keepLines/><w:spacing w:after="120"/>`,
    rPr: `<w:sz w:val="18"/><w:szCs w:val="18"/>`,
  }),
  paragraphStyle("Muted", "Muted", {
    basedOn: "Normal",
    rPr: `<w:color w:val="${INK_MUTED}"/>`,
  }),
  paragraphStyle("ListParagraph", "List Paragraph", {
    basedOn: "Normal",
    pPr: `<w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/>`,
  }),
  paragraphStyle("Warning", "Warning", {
    basedOn: "Normal",
    next: "Normal",
    pPr: `<w:keepLines/><w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="${SEAL_RED}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${WARNING_FILL}"/><w:spacing w:before="120" w:after="160"/><w:ind w:left="198" w:right="113"/>`,
  }),
  paragraphStyle("Note", "Note", {
    basedOn: "Normal",
    next: "Normal",
    pPr: `<w:keepLines/><w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="${BRASS}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${NOTE_FILL}"/><w:spacing w:before="120" w:after="160"/><w:ind w:left="198" w:right="113"/>`,
  }),
  paragraphStyle("Figure", "Figure", {
    basedOn: "Normal",
    next: "Caption",
    pPr: `<w:keepNext/><w:spacing w:before="160" w:after="60"/>`,
  }),
  paragraphStyle("Caption", "caption", {
    basedOn: "Normal",
    next: "Normal",
    pPr: `<w:spacing w:after="240"/>`,
    rPr: `<w:i/><w:iCs/><w:color w:val="${INK_MUTED}"/><w:sz w:val="17"/><w:szCs w:val="17"/>`,
  }),
  paragraphStyle("TableText", "Table Text", {
    basedOn: "Normal",
    pPr: `<w:spacing w:before="40" w:after="40" w:line="252" w:lineRule="auto"/>`,
    rPr: `<w:sz w:val="19"/><w:szCs w:val="19"/>`,
  }),
  paragraphStyle("TableSpacer", "Table Spacer", {
    basedOn: "Normal",
    pPr: `<w:spacing w:after="0" w:line="160" w:lineRule="exact"/>`,
    rPr: `<w:sz w:val="12"/><w:szCs w:val="12"/>`,
  }),
  paragraphStyle("Header", "header", {
    basedOn: "Normal",
    pPr: `<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="${LIMESTONE}"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="${TEXT_WIDTH}"/></w:tabs><w:spacing w:after="0"/>`,
    rPr: `<w:color w:val="${INK_MUTED}"/><w:sz w:val="16"/><w:szCs w:val="16"/>`,
  }),
  paragraphStyle("Footer", "footer", {
    basedOn: "Normal",
    pPr: `<w:tabs><w:tab w:val="right" w:pos="${TEXT_WIDTH}"/></w:tabs><w:spacing w:after="0"/>`,
    rPr: `<w:color w:val="${INK_MUTED}"/><w:sz w:val="16"/><w:szCs w:val="16"/>`,
  }),
  `<w:style w:type="table" w:styleId="ProcessTable"><w:name w:val="Process Table"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="59"/><w:tblPr><w:tblBorders><w:top ${BORDER}/><w:left ${BORDER}/><w:bottom ${BORDER}/><w:right ${BORDER}/><w:insideH ${BORDER}/><w:insideV ${BORDER}/></w:tblBorders><w:tblCellMar><w:top w:w="28" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="28" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:bCs/></w:rPr><w:tblPr/><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="${LIMESTONE}"/></w:tcPr></w:tblStylePr></w:style>`,
].join("")}</w:styles>`;

const SETTINGS_XML = `${XML_HEAD}<w:settings xmlns:w="${NS.w}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat><w:decimalSymbol w:val="."/><w:listSeparator w:val=","/></w:settings>`;
