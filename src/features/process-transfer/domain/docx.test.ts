import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { DocumentMeta } from "./document";
import { buildDocx, escapeXml, xmlSafe } from "./docx";
import type { Frames } from "./frames";
import { frameKey } from "./frames";
import type { Process } from "./process";
import { SAMPLE_PROCESS } from "./test-fixtures";

const meta: DocumentMeta = {
  recordingName: "Month-end handover.mp4",
  generatedAt: "2026-11-17T09:30:00.000Z",
  status: "draft",
};

// The smallest valid images: a 1x1 PNG and the first bytes of a JPEG. The
// writer never decodes them, it only copies them into word/media.
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48,
  0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

const frames: Frames = {
  [frameKey(42)]: { bytes: JPEG, width: 1280, height: 720, mime: "image/jpeg" },
  [frameKey(95)]: { bytes: PNG, width: 800, height: 1000, mime: "image/png" },
};

function unpack(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  return Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => /\.(xml|rels)$/.test(name))
      .map(([name, data]) => [name, strFromU8(data)]),
  );
}

/**
 * A strict well-formedness check, enough to catch what a hand-written writer
 * gets wrong: unbalanced or crossed tags, unquoted or duplicate attributes,
 * a raw "<" or "&" in text, a character XML 1.0 forbids, more than one root.
 */
function assertWellFormed(name: string, xml: string) {
  const fail = (why: string, at: number) => {
    throw new Error(`${name}: ${why} at ${at}: ${xml.slice(at, at + 80)}`);
  };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: checking for them is the point
  const forbidden = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/.exec(xml);
  if (forbidden) fail("forbidden character", forbidden.index);
  const entity = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g;
  const stack: string[] = [];
  let roots = 0;
  let index = 0;
  if (xml.startsWith("<?xml")) index = xml.indexOf("?>") + 2;
  while (index < xml.length) {
    const open = xml.indexOf("<", index);
    const text = xml.slice(index, open === -1 ? xml.length : open);
    if (text.includes(">")) fail("raw > in text", index);
    entity.lastIndex = 0;
    if (entity.test(text)) fail("raw & in text", index);
    if (stack.length === 0 && text.trim()) fail("text outside the root", index);
    if (open === -1) break;
    const close = xml.indexOf(">", open);
    if (close === -1) fail("unclosed tag", open);
    const tag = xml.slice(open + 1, close);
    if (tag.startsWith("/")) {
      const tagName = tag.slice(1).trim();
      if (stack.pop() !== tagName) fail(`mismatched </${tagName}>`, open);
    } else {
      const selfClosing = tag.endsWith("/");
      const body = selfClosing ? tag.slice(0, -1) : tag;
      const match = /^([\w:.-]+)((?:\s+[\w:.-]+="[^"<]*")*)\s*$/.exec(body);
      if (!match) fail("malformed tag", open);
      const [, tagName, attrs] = match as RegExpExecArray;
      const names = [...attrs.matchAll(/([\w:.-]+)="([^"]*)"/g)].map((item) => {
        entity.lastIndex = 0;
        if (entity.test(item[2])) fail("raw & in attribute", open);
        return item[1];
      });
      if (new Set(names).size !== names.length) {
        fail("duplicate attribute", open);
      }
      if (stack.length === 0) roots++;
      if (!selfClosing) stack.push(tagName);
    }
    index = close + 1;
  }
  if (stack.length > 0) fail(`unclosed <${stack.at(-1)}>`, xml.length);
  if (roots !== 1) fail(`${roots} root elements`, 0);
}

function relationships(xml: string) {
  return [
    ...xml.matchAll(
      /<Relationship Id="([^"]+)" Type="([^"]+)" Target="([^"]+)"/g,
    ),
  ].map(([, id, type, target]) => ({ id, type, target }));
}

describe("buildDocx", () => {
  const bytes = buildDocx(SAMPLE_PROCESS, { frames, meta });
  const parts = unpack(bytes);
  const all = Object.keys(unzipSync(bytes));
  const document = parts["word/document.xml"];

  it("unzips into the parts of a Word document", () => {
    expect(all).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/core.xml",
        "docProps/app.xml",
        "word/document.xml",
        "word/_rels/document.xml.rels",
        "word/styles.xml",
        "word/numbering.xml",
        "word/settings.xml",
        "word/header1.xml",
        "word/footer1.xml",
      ]),
    );
    expect(all[0]).toBe("[Content_Types].xml");
  });

  it("writes every part as well-formed XML", () => {
    for (const [name, xml] of Object.entries(parts)) {
      expect(() => assertWellFormed(name, xml)).not.toThrow();
    }
  });

  it("points every relationship at a part that exists", () => {
    for (const name of Object.keys(parts).filter((item) =>
      item.endsWith(".rels"),
    )) {
      const base = name.replace(/_rels\/[^/]*\.rels$/, "");
      for (const item of relationships(parts[name])) {
        expect(all, `${name} -> ${item.target}`).toContain(
          `${base}${item.target}`,
        );
      }
    }
    const ids = relationships(parts["word/_rels/document.xml.rels"]).map(
      (item) => item.id,
    );
    for (const [, id] of document.matchAll(/r:(?:embed|id)="([^"]+)"/g)) {
      expect(ids).toContain(id);
    }
  });

  it("gives every part a content type", () => {
    const types = parts["[Content_Types].xml"];
    const defaults = [...types.matchAll(/Default Extension="([^"]+)"/g)].map(
      (item) => item[1],
    );
    const overrides = [...types.matchAll(/PartName="\/([^"]+)"/g)].map(
      (item) => item[1],
    );
    for (const name of all.filter((item) => item !== "[Content_Types].xml")) {
      const extension = name.split(".").at(-1) ?? "";
      expect(
        overrides.includes(name) || defaults.includes(extension),
        name,
      ).toBe(true);
    }
    for (const name of overrides) expect(all).toContain(name);
  });

  it("embeds the Frames given, scaled to the page, with alt text", () => {
    expect(all.filter((name) => name.startsWith("word/media/"))).toEqual([
      "word/media/frame1.jpeg",
      "word/media/frame2.png",
    ]);
    expect(unzipSync(bytes)["word/media/frame2.png"]).toEqual(PNG);
    const extents = [
      ...document.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g),
    ].map(([, cx, cy]) => [Number(cx), Number(cy)]);
    expect(extents).toHaveLength(2);
    // 16:9 is capped by height, 4:5 too; both keep their aspect.
    for (const [[cx, cy], [w, h]] of extents.map(
      (extent, index) =>
        [extent, index === 0 ? [1280, 720] : [800, 1000]] as const,
    )) {
      expect(cx).toBeLessThanOrEqual(9638 * 635);
      expect(Math.abs(cx / cy - w / h)).toBeLessThan(0.01);
    }
    expect(document).toContain(
      'descr="Screen at 0:42 in the recording, step 1: Download the treasury statement"',
    );
    expect(document).toContain("Figure 2. Step 2 at 1:35 in the recording");
  });

  it("has no picture at all without Frames", () => {
    const plain = buildDocx(SAMPLE_PROCESS, { frames: {}, meta });
    const names = Object.keys(unzipSync(plain));
    expect(names.some((name) => name.startsWith("word/media/"))).toBe(false);
    const xml = unpack(plain)["word/document.xml"];
    expect(xml).not.toContain("<w:drawing>");
    expect(xml).not.toContain("Figure");
    expect(unpack(plain)["[Content_Types].xml"]).not.toContain("jpeg");
  });

  it("uses real numbering, styles, repeating header rows and page fields", () => {
    expect(document.match(/<w:numId w:val="3"\/>/g)).toHaveLength(9); // steps
    expect(document).toContain('<w:pStyle w:val="Heading1"/>');
    expect(document).toContain("<w:tblHeader/>");
    expect(document).toContain("<w:keepNext/>");
    expect(document).not.toMatch(/<w:t[^>]*>\d+\. /); // no typed "1."
    expect(parts["word/numbering.xml"]).toContain('w:val="Step %1:"');
    expect(parts["word/footer1.xml"]).toContain('w:instr=" PAGE ');
    expect(parts["word/footer1.xml"]).toContain('w:instr=" NUMPAGES ');
    expect(parts["word/header1.xml"]).toContain(
      "Month-end contribution reconciliation",
    );
    expect(document).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
  });

  it("restarts each numbered list at 1", () => {
    const process: Process = structuredClone(SAMPLE_PROCESS);
    const xml = unpack(buildDocx(process, { frames: {}, meta }))[
      "word/numbering.xml"
    ];
    expect(xml).toContain('<w:num w:numId="4"><w:abstractNumId w:val="3"/>');
    expect(xml).toContain('<w:startOverride w:val="1"/>');
  });

  it("keeps special characters intact and drops what XML forbids", () => {
    const process: Process = structuredClone(SAMPLE_PROCESS);
    process.title = `R&D <"quoted"> & 'single' 😀`;
    process.steps[0].action = "Tab\there, bell\u0007, lone \uD800 surrogate";
    process.glossary.push({ term: "A&B", meaning: "]]> <![CDATA[" });
    const out = unpack(buildDocx(process, { frames, meta }));
    for (const [name, xml] of Object.entries(out)) {
      expect(() => assertWellFormed(name, xml)).not.toThrow();
    }
    expect(out["word/document.xml"]).toContain(
      "R&amp;D &lt;&quot;quoted&quot;&gt; &amp; &apos;single&apos; 😀",
    );
    expect(out["word/document.xml"]).toContain("<w:tab/>");
    expect(out["word/document.xml"]).not.toContain("\u0007");
    expect(out["word/document.xml"]).toContain("lone � surrogate");
    expect(out["docProps/core.xml"]).toContain(
      "<dc:title>R&amp;D &lt;&quot;quoted&quot;&gt;",
    );
  });

  it("keeps a step's heading, meta, instruction and screenshot on one page", () => {
    // Step 1 has a Frame and two details: the chain runs heading -> meta ->
    // instruction -> figure (all keepNext) -> caption; the details follow and flow.
    const start = document.indexOf('<w:pStyle w:val="StepHeading"/>');
    const end = document.indexOf('<w:pStyle w:val="StepHeading"/>', start + 1);
    const paragraphs = document
      .slice(
        document.lastIndexOf("<w:p>", start),
        document.lastIndexOf("<w:p>", end),
      )
      .split("<w:p>")
      .filter(Boolean);
    const kinds = paragraphs.map((item) =>
      item.includes("<w:drawing>")
        ? "figure"
        : (/<w:pStyle w:val="(\w+)"\/>/.exec(item)?.[1] ?? "Normal"),
    );
    expect(kinds).toEqual([
      "StepHeading",
      "StepMeta",
      "Normal",
      "figure",
      "Caption",
      "ListParagraph",
      "ListParagraph",
    ]);
    const keepNext = paragraphs.map((item) => item.includes("<w:keepNext/>"));
    expect(keepNext).toEqual([false, false, true, true, false, false, false]);
    // StepHeading and StepMeta carry keepNext in their styles.
    expect(parts["word/styles.xml"]).toMatch(
      /w:styleId="StepMeta">.*?<w:keepNext\/>.*?<\/w:style>/,
    );
  });

  it("is the same bytes for the same input", () => {
    expect(buildDocx(SAMPLE_PROCESS, { frames, meta })).toEqual(bytes);
  });
});

describe("xml escaping", () => {
  it("escapes the five specials and keeps emoji", () => {
    expect(escapeXml(`<a href="x">&'🚀`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&apos;🚀",
    );
  });
  it("drops control characters but keeps tab and newline", () => {
    expect(xmlSafe("a\u0000b\u001Fc\td\ne")).toBe("abc\td\ne");
  });
});
