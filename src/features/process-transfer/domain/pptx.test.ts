import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { Deck } from "./deck";
import { planFromProcess } from "./deck-fit";
import { layoutDeck } from "./deck-layout";
import { type Frames, frameKey } from "./frames";
import { buildPptx } from "./pptx";
import { resolveRules, ruleSet } from "./rules";
import { SAMPLE_PROCESS } from "./test-fixtures";

const rules = ruleSet(resolveRules());
const deck = layoutDeck(
  planFromProcess(SAMPLE_PROCESS, rules),
  SAMPLE_PROCESS,
  rules,
);

/** A 1x1 JPEG: enough bytes for a part, never decoded here. */
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9,
]);

const frames: Frames = Object.fromEntries(
  SAMPLE_PROCESS.steps
    .filter((step) => step.id !== "s4")
    .map((step) => [
      frameKey(step.at),
      { bytes: JPEG, width: 1280, height: 720, mime: "image/jpeg" as const },
    ]),
);

function unzip(bytes: Uint8Array): Map<string, string> {
  const files = unzipSync(bytes);
  return new Map(
    Object.entries(files).map(([path, data]) => [
      path,
      path.startsWith("ppt/media/") ? "" : strFromU8(data),
    ]),
  );
}

type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
};

/**
 * A strict well-formedness check: one root, balanced tags, quoted and unique
 * attributes, entities only from XML's five, and every prefix declared.
 * Returns the tree so tests can look inside.
 */
function parseXml(xml: string): XmlNode {
  let at = 0;
  const fail = (why: string): never => {
    throw new Error(`${why} at ${at}: ${xml.slice(at, at + 60)}`);
  };
  if (xml.startsWith("<?xml")) at = xml.indexOf("?>") + 2;
  const root: XmlNode = { name: "#document", attrs: {}, children: [] };
  const stack: { node: XmlNode; prefixes: Set<string> }[] = [
    { node: root, prefixes: new Set(["xml"]) },
  ];
  const text = (chunk: string) => {
    if (/<|&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(chunk))
      fail("bad character data");
  };
  while (at < xml.length) {
    const open = xml.indexOf("<", at);
    if (open < 0) {
      if (xml.slice(at).trim()) fail("text after the root");
      break;
    }
    const between = xml.slice(at, open);
    if (stack.length === 1 && between.trim()) fail("text outside the root");
    text(between);
    at = open;
    const close = xml.indexOf(">", at);
    if (close < 0) fail("unclosed tag");
    const tag = xml.slice(at + 1, close);
    at = close + 1;
    if (tag.startsWith("/")) {
      const top = stack.pop();
      if (!top || top.node.name !== tag.slice(1).trim())
        fail(`mismatched </${tag.slice(1)}>`);
      continue;
    }
    const selfClosing = tag.endsWith("/");
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const match = body.match(/^([A-Za-z_][\w.:-]*)([\s\S]*)$/);
    if (!match) fail("bad tag name");
    const [, name, rest] = match as RegExpMatchArray;
    const attrs: Record<string, string> = {};
    const attrPattern = /\s+([A-Za-z_][\w.:-]*)="([^"<]*)"/y;
    let index = 0;
    while (index < rest.trimEnd().length) {
      attrPattern.lastIndex = index;
      const attr = attrPattern.exec(rest);
      if (!attr) fail(`bad attribute in <${name}>`);
      const [whole, key, value] = attr as RegExpExecArray;
      if (key in attrs) fail(`duplicate attribute ${key}`);
      text(value);
      attrs[key] = value;
      index += whole.length;
    }
    if (stack.length === 1 && root.children.length > 0) fail("two roots");
    const prefixes = new Set(stack[stack.length - 1].prefixes);
    for (const key of Object.keys(attrs))
      if (key.startsWith("xmlns:")) prefixes.add(key.slice(6));
    for (const used of [
      name,
      ...Object.keys(attrs).filter((key) => !key.startsWith("xmlns")),
    ]) {
      const prefix = used.includes(":") ? used.split(":")[0] : null;
      if (prefix && !prefixes.has(prefix)) fail(`undeclared prefix ${prefix}`);
    }
    const node: XmlNode = { name, attrs, children: [] };
    stack[stack.length - 1].node.children.push(node);
    if (!selfClosing) stack.push({ node, prefixes });
  }
  if (stack.length !== 1) fail("unclosed elements");
  if (root.children.length !== 1) fail("no root");
  return root.children[0];
}

function all(node: XmlNode, name: string): XmlNode[] {
  return [
    ...(node.name === name ? [node] : []),
    ...node.children.flatMap((child) => all(child, name)),
  ];
}

function resolve(from: string, target: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== ".") parts.push(piece);
  }
  return parts.join("/");
}

function relsOf(files: Map<string, string>, part: string) {
  const dir = part.split("/").slice(0, -1).join("/");
  const file = part.split("/").at(-1);
  const relsPath = `${dir ? `${dir}/` : ""}_rels/${file}.rels`;
  const xml = files.get(relsPath);
  if (!xml) return [];
  return all(parseXml(xml), "Relationship").map((rel) => ({
    id: rel.attrs.Id,
    type: rel.attrs.Type.split("/").at(-1) as string,
    target: resolve(part, rel.attrs.Target),
  }));
}

describe("buildPptx", () => {
  const bytes = buildPptx(deck, {
    frames,
    approved: true,
    author: "Daniel Reyes",
    createdAt: "2026-11-17T09:30:00.123Z",
  });
  const files = unzip(bytes);

  it("is a zip with the parts a presentation needs", () => {
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "docProps/app.xml",
      "ppt/presentation.xml",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/theme/theme1.xml",
      "ppt/notesMasters/notesMaster1.xml",
    ]) {
      expect(files.has(part), part).toBe(true);
    }
  });

  it("writes well-formed XML in every part", () => {
    for (const [path, xml] of files) {
      if (path.endsWith(".xml") || path.endsWith(".rels")) {
        expect(() => parseXml(xml), path).not.toThrow();
      }
    }
  });

  it("points every relationship at a part that exists", () => {
    for (const path of files.keys()) {
      if (!path.endsWith(".rels")) continue;
      const source = path.replace("_rels/", "").replace(/\.rels$/, "");
      for (const rel of relsOf(files, source === ".rels" ? "" : source)) {
        expect(files.has(rel.target), `${path} → ${rel.target}`).toBe(true);
      }
    }
    for (const rel of relsOf(files, ""))
      expect(files.has(rel.target)).toBe(true);
  });

  it("gives every part a content type", () => {
    const types = parseXml(files.get("[Content_Types].xml") as string);
    const defaults = new Set(
      all(types, "Default").map((item) => item.attrs.Extension),
    );
    const overrides = new Set(
      all(types, "Override").map((item) => item.attrs.PartName),
    );
    for (const path of files.keys()) {
      if (path === "[Content_Types].xml") continue;
      const extension = path.split(".").at(-1) as string;
      const covered =
        overrides.has(`/${path}`) ||
        (defaults.has(extension) && !path.endsWith(".xml"));
      expect(
        covered || (extension === "xml" && overrides.has(`/${path}`)),
        path,
      ).toBe(true);
    }
    for (const part of overrides)
      expect(files.has(part.slice(1)), part).toBe(true);
  });

  it("has one slide per Deck slide, 16:9, in order", () => {
    const presentation = parseXml(files.get("ppt/presentation.xml") as string);
    expect(all(presentation, "p:sldSz")[0].attrs).toEqual({
      cx: "12192000",
      cy: "6858000",
    });
    const ids = all(presentation, "p:sldId");
    expect(ids).toHaveLength(deck.slides.length);
    const rels = relsOf(files, "ppt/presentation.xml");
    expect(
      ids.map((id) => rels.find((rel) => rel.id === id.attrs["r:id"])?.target),
    ).toEqual(
      deck.slides.map((_, index) => `ppt/slides/slide${index + 1}.xml`),
    );
    expect(files.get("docProps/app.xml")).toContain(
      `<Slides>${deck.slides.length}</Slides>`,
    );
    expect(files.get("docProps/core.xml")).toContain("2026-11-17T09:30:00Z");
  });

  it("places every element at its Deck position and size", () => {
    deck.slides.forEach((slide, index) => {
      const xml = parseXml(
        files.get(`ppt/slides/slide${index + 1}.xml`) as string,
      );
      const offsets = all(xml, "a:off").slice(0);
      const exts = all(xml, "a:ext").filter(
        (node) => node.attrs.cx !== "0" || node.attrs.cy !== "0",
      );
      // The group transform is all zeros; the rest are the elements, back to front.
      const placed = offsets
        .slice(1)
        .map((off, at) =>
          [off.attrs.x, off.attrs.y, exts[at].attrs.cx, exts[at].attrs.cy].map(
            Number,
          ),
        );
      expect(placed).toEqual(
        slide.elements.map((element) =>
          [element.x, element.y, element.w, element.h].map((px) =>
            Math.round(px * 9525),
          ),
        ),
      );
    });
  });

  it("animates exactly the Deck's entrances, targeting shapes that exist on the slide", () => {
    deck.slides.forEach((slide, index) => {
      const xml = parseXml(
        files.get(`ppt/slides/slide${index + 1}.xml`) as string,
      );
      const shapeIds = new Set(
        all(xml, "p:cNvPr").map((node) => node.attrs.id),
      );
      const targets = all(xml, "p:spTgt").map((node) => node.attrs.spid);
      for (const target of targets)
        expect(shapeIds.has(target), `slide ${index + 1} spid ${target}`).toBe(
          true,
        );
      for (const build of all(xml, "p:bldP"))
        expect(shapeIds.has(build.attrs.spid)).toBe(true);
      const effects = all(xml, "p:cTn").filter(
        (node) => node.attrs.presetClass === "entr",
      );
      const animated = slide.elements
        .filter((element) => element.animation)
        .sort((a, b) => (a.animation?.order ?? 0) - (b.animation?.order ?? 0));
      expect(
        effects.map((node) => [node.attrs.presetID, node.attrs.nodeType]),
      ).toEqual(
        animated.map((element) => [
          { fade: "10", wipe: "22", rise: "42", zoom: "53" }[
            element.animation?.effect ?? "fade"
          ],
          `${element.animation?.trigger}Effect`,
        ]),
      );
      const timeNodeIds = all(xml, "p:cTn").map((node) => node.attrs.id);
      expect(new Set(timeNodeIds).size).toBe(timeNodeIds.length);
      if (animated.length > 0) {
        expect(
          all(xml, "p:cTn").find((node) => node.attrs.nodeType === "mainSeq"),
        ).toBeDefined();
      }
    });
  });

  it("marks every slide of an unapproved deck as a draft, and none of an approved one", () => {
    const draft = unzip(buildPptx(deck, { frames: {}, approved: false }));
    deck.slides.forEach((_, index) => {
      expect(draft.get(`ppt/slides/slide${index + 1}.xml`)).toContain(
        "DRAFT · NOT APPROVED",
      );
      expect(files.get(`ppt/slides/slide${index + 1}.xml`)).not.toContain(
        "DRAFT",
      );
    });
  });

  it("escapes text that would break the XML", () => {
    const tricky: Deck = structuredClone(deck);
    tricky.title = `Fees & charges <draft> "quoted" 'single' \u0001 end`;
    const slide = tricky.slides[1];
    const title = slide.elements.find((element) => element.role === "title");
    if (title?.type === "text")
      title.paragraphs = [{ runs: [{ text: "A & B < C\nnext line" }] }];
    slide.notes = "Say <this> & that\n\nThen this.";
    const out = unzip(buildPptx(tricky, { frames: {}, approved: true }));
    for (const [path, xml] of out)
      if (path.endsWith(".xml"))
        expect(() => parseXml(xml), path).not.toThrow();
    expect(out.get("ppt/slides/slide2.xml")).toContain(
      "A &amp; B &lt; C</a:t></a:r><a:br>",
    );
  });
});
