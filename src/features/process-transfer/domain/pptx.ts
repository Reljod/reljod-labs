import { strToU8, type Zippable, zipSync } from "fflate";
import {
  type Animation,
  type Deck,
  EMU_PER_PX,
  type ImageElement,
  type Paragraph,
  type ShapeElement,
  SLIDE_H,
  SLIDE_W,
  type Slide,
  type SlideElement,
  type TextElement,
} from "./deck";
import { entranceSchedule, placeholderText, RISE_OFFSET } from "./deck-layout";
import { bulletIndent } from "./deck-text";
import { type Frame, type Frames, frameKey } from "./frames";

/*
 * The Deck as a PowerPoint file, written by hand in PresentationML and zipped
 * with fflate. Pure: it runs in the browser (where the Frames are) and in
 * Node (for tests). Every element lands at its exact Deck position; text
 * carries explicit sizes, fonts, colours, insets and line pitch so PowerPoint
 * does not reflow it; transitions and entrances are written in the same
 * shape PowerPoint itself writes them, because it repairs or refuses files
 * whose timing tree it does not expect.
 */

export type PptxOptions = {
  frames: Frames;
  /** False puts a "DRAFT · NOT APPROVED" marker on every slide. */
  approved: boolean;
  author?: string;
  /** ISO time for the document properties and the zip entries; omitted keeps the output byte-identical. */
  createdAt?: string;
};

const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
  ct: "http://schemas.openxmlformats.org/package/2006/content-types",
};
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PML = "application/vnd.openxmlformats-officedocument.presentationml";
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const PML_NS = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;

export const PPTX_MIME = `${PML}.presentation`;

// biome-ignore lint/suspicious/noControlCharactersInRegex: these are exactly the characters XML 1.0 forbids
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Characters XML 1.0 cannot hold are dropped; the rest is escaped. */
function esc(text: string): string {
  return text
    .replace(NOT_XML, "")
    .replace(LONE_SURROGATE, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const emu = (px: number) => Math.round(px * EMU_PER_PX);

function rgb(color: string | null | undefined, fallback = "000000"): string {
  const value = (color ?? "").replace("#", "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(value) ? value : fallback;
}

const solid = (color: string) =>
  `<a:solidFill><a:srgbClr val="${rgb(color)}"/></a:solidFill>`;

function xfrm(element: Pick<SlideElement, "x" | "y" | "w" | "h">): string {
  return `<a:xfrm><a:off x="${emu(element.x)}" y="${emu(element.y)}"/><a:ext cx="${Math.max(0, emu(element.w))}" cy="${Math.max(0, emu(element.h))}"/></a:xfrm>`;
}

type Fonts = Deck["theme"]["fonts"];

const ALIGN = { left: "l", center: "ctr", right: "r" } as const;
const ANCHOR = { top: "t", middle: "ctr", bottom: "b" } as const;

function runXml(
  text: string,
  options: { size: number; bold: boolean; color: string; typeface: string },
): string {
  const rPr = `<a:rPr lang="en-GB" sz="${Math.round(options.size * 100)}"${options.bold ? ' b="1"' : ""} dirty="0">${solid(options.color)}<a:latin typeface="${esc(options.typeface)}"/><a:cs typeface="${esc(options.typeface)}"/></a:rPr>`;
  // A newline inside a run is a line break, as in the measurement.
  return text
    .split("\n")
    .map((part) => `<a:r>${rPr}<a:t>${esc(part)}</a:t></a:r>`)
    .join(`<a:br>${rPr}</a:br>`);
}

function paragraphXml(
  paragraph: Paragraph,
  index: number,
  element: TextElement,
  fonts: Fonts,
  bulletColor: string,
): string {
  const typeface = fonts[element.font];
  const size = element.fontSize;
  const indent = paragraph.bullet ? bulletIndent(size) : 0;
  const attrs = [
    paragraph.bullet
      ? `marL="${emu(indent)}" indent="${-emu(indent)}"`
      : 'marL="0" indent="0"',
    `algn="${ALIGN[element.align]}"`,
  ].join(" ");
  const spacing = `<a:lnSpc><a:spcPts val="${Math.round(size * element.lineHeight * 100)}"/></a:lnSpc><a:spcBef><a:spcPts val="${index > 0 ? Math.round((paragraph.gapBefore ?? 0) * 75) : 0}"/></a:spcBef>`;
  const bullet = paragraph.bullet
    ? `<a:buClr><a:srgbClr val="${rgb(bulletColor)}"/></a:buClr><a:buSzPct val="60000"/><a:buFont typeface="Arial"/><a:buChar char="■"/>`
    : "<a:buNone/>";
  const runs = paragraph.runs
    .filter((item) => item.text.length > 0)
    .map((item) =>
      runXml(item.text, {
        size,
        bold: Boolean(item.bold),
        color: item.color ?? element.color,
        typeface,
      }),
    )
    .join("");
  return `<a:p><a:pPr ${attrs}>${spacing}${bullet}</a:pPr>${runs}<a:endParaRPr lang="en-GB" sz="${Math.round(size * 100)}" dirty="0"/></a:p>`;
}

function bodyXml(
  element: TextElement,
  fonts: Fonts,
  bulletColor: string,
): string {
  const inset = emu(element.padding);
  const paragraphs = element.paragraphs.length
    ? element.paragraphs
    : [{ runs: [] }];
  return `<p:txBody><a:bodyPr wrap="square" lIns="${inset}" tIns="${inset}" rIns="${inset}" bIns="${inset}" anchor="${ANCHOR[element.valign]}" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs
    .map((paragraph, index) =>
      paragraphXml(paragraph, index, element, fonts, bulletColor),
    )
    .join("")}</p:txBody>`;
}

function nameOf(element: SlideElement, id: number): string {
  const role = element.role.charAt(0).toUpperCase() + element.role.slice(1);
  return `${role} ${id}`;
}

function textShape(
  element: TextElement,
  id: number,
  fonts: Fonts,
  bulletColor: string,
): string {
  const fill = element.fill ? solid(element.fill) : "<a:noFill/>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(nameOf(element, id))}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(element)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}<a:ln><a:noFill/></a:ln></p:spPr>${bodyXml(element, fonts, bulletColor)}</p:sp>`;
}

const GEOMETRY: Record<ShapeElement["shape"], string> = {
  rect: "rect",
  roundRect: "roundRect",
  ellipse: "ellipse",
  line: "line",
  chevron: "chevron",
};

function shapeShape(element: ShapeElement, id: number): string {
  const fill =
    element.fill && element.shape !== "line"
      ? solid(element.fill)
      : "<a:noFill/>";
  const line =
    element.stroke && element.strokeWidth > 0
      ? `<a:ln w="${emu(element.strokeWidth)}">${solid(element.stroke)}</a:ln>`
      : "<a:ln><a:noFill/></a:ln>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(nameOf(element, id))}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(element)}<a:prstGeom prst="${GEOMETRY[element.shape]}"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr></p:sp>`;
}

/** Crops the frame to the box's shape, like CSS `object-fit: cover`. */
function cover(frame: Frame, element: ImageElement): string {
  if (!frame.width || !frame.height || !element.w || !element.h) return "";
  const source = frame.width / frame.height;
  const box = element.w / element.h;
  if (Math.abs(source - box) < 0.001) return "";
  if (source > box) {
    const side = Math.round(((1 - box / source) / 2) * 100000);
    return `<a:srcRect l="${side}" r="${side}"/>`;
  }
  const side = Math.round(((1 - source / box) / 2) * 100000);
  return `<a:srcRect t="${side}" b="${side}"/>`;
}

function pictureShape(
  element: ImageElement,
  id: number,
  relId: string,
  frame: Frame,
  ink: string,
): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(nameOf(element, id))}" descr="${esc(element.alt)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/>${cover(frame, element)}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(element)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="${EMU_PER_PX}">${solid(ink)}</a:ln></p:spPr></p:pic>`;
}

function placeholderShape(
  element: ImageElement,
  id: number,
  deck: Deck,
): string {
  const c = deck.theme.colors;
  const text: TextElement = {
    ...element,
    type: "text",
    paragraphs: [{ runs: [{ text: placeholderText(element) }] }],
    fontSize: 13,
    font: "body",
    color: c.muted,
    align: "center",
    valign: "middle",
    lineHeight: 1.2,
    padding: 8,
    fill: c.surface,
  };
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(nameOf(element, id))}" descr="${esc(element.alt)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(element)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solid(c.surface)}<a:ln w="${EMU_PER_PX}">${solid(c.muted)}<a:prstDash val="dash"/></a:ln></p:spPr>${bodyXml(text, deck.theme.fonts, c.accent)}</p:sp>`;
}

function draftShape(id: number, warn: string): string {
  const w = 236;
  const marker: TextElement = {
    id: "draft",
    type: "text",
    role: "label",
    x: SLIDE_W - 24 - w,
    y: 16,
    w,
    h: 28,
    animation: null,
    paragraphs: [{ runs: [{ text: "DRAFT · NOT APPROVED", bold: true }] }],
    fontSize: 11,
    font: "body",
    color: warn,
    align: "center",
    valign: "middle",
    lineHeight: 1.2,
    padding: 4,
    fill: "#ffffff",
  };
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Draft marker"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(marker)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solid("#ffffff")}<a:ln w="${2 * EMU_PER_PX}">${solid(warn)}</a:ln></p:spPr>${bodyXml(marker, { heading: "Arial", body: "Arial", mono: "Arial" }, warn)}</p:sp>`;
}

function transitionXml(slide: Slide): string {
  const { type, durationMs } = slide.transition;
  if (type === "none" || durationMs <= 0) return "";
  const effect = {
    fade: "<p:fade/>",
    push: '<p:push dir="l"/>',
    wipe: '<p:wipe dir="r"/>',
  }[type];
  const speed = durationMs <= 500 ? "fast" : durationMs <= 750 ? "med" : "slow";
  // PowerPoint 2010 and later read the exact duration; older readers take the fallback.
  return `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14"><p:transition spd="${speed}" p14:dur="${Math.round(durationMs)}">${effect}</p:transition></mc:Choice><mc:Fallback><p:transition spd="${speed}">${effect}</p:transition></mc:Fallback></mc:AlternateContent>`;
}

/** PowerPoint's preset for each entrance: Fade, Wipe from left, Float In, Zoom. */
const PRESETS: Record<Animation["effect"], { id: number; subtype: number }> = {
  fade: { id: 10, subtype: 0 },
  wipe: { id: 22, subtype: 8 },
  rise: { id: 42, subtype: 0 },
  zoom: { id: 53, subtype: 16 },
};

const NODE_TYPES = {
  click: "clickEffect",
  after: "afterEffect",
  with: "withEffect",
} as const;

class Ids {
  private value = 0;
  next(): number {
    this.value += 1;
    return this.value;
  }
}

function target(spid: number): string {
  return `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`;
}

function behaviours(
  effect: Animation["effect"],
  spid: number,
  dur: number,
  ids: Ids,
): string {
  const set = `<p:set><p:cBhvr><p:cTn id="${ids.next()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>${target(spid)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`;
  const fade = () =>
    `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${ids.next()}" dur="${dur}"/>${target(spid)}</p:cBhvr></p:animEffect>`;
  const anim = (attr: string, from: string, to: string) =>
    `<p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="${ids.next()}" dur="${dur}" fill="hold"/>${target(spid)}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val>${from}</p:val></p:tav><p:tav tm="100000"><p:val>${to}</p:val></p:tav></p:tavLst></p:anim>`;
  const str = (value: string) => `<p:strVal val="${value}"/>`;
  switch (effect) {
    case "fade":
      return set + fade();
    case "wipe":
      return `${set}<p:animEffect transition="in" filter="wipe(left)"><p:cBhvr><p:cTn id="${ids.next()}" dur="${dur}"/>${target(spid)}</p:cBhvr></p:animEffect>`;
    case "rise":
      return (
        set +
        fade() +
        anim("ppt_x", str("#ppt_x"), str("#ppt_x")) +
        anim("ppt_y", str(`#ppt_y+${RISE_OFFSET}`), str("#ppt_y"))
      );
    case "zoom":
      return (
        set +
        anim("ppt_w", '<p:fltVal val="0"/>', str("#ppt_w")) +
        anim("ppt_h", '<p:fltVal val="0"/>', str("#ppt_h")) +
        fade()
      );
  }
}

/**
 * The slide's timing tree: the main sequence holds one par per click group
 * (group 0 starts with the slide), each holding one par per step that starts
 * when the step before ends, each holding the effects that run together.
 */
function timingXml(
  slide: Slide,
  shapeIds: Map<string, number>,
  animBg: Set<string>,
): string {
  const schedule = entranceSchedule(slide);
  if (schedule.length === 0) return "";
  const byId = new Map(slide.elements.map((element) => [element.id, element]));
  const ids = new Ids();
  const root = ids.next();
  const main = ids.next();
  const groups = [...new Set(schedule.map((item) => item.group))].sort(
    (a, b) => a - b,
  );
  const groupXml = groups.map((group) => {
    const items = schedule.filter((item) => item.group === group);
    const outer = ids.next();
    const start =
      group === 0
        ? `<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="${main}"/></p:cond>`
        : '<p:cond delay="indefinite"/>';
    const steps = [...new Set(items.map((item) => item.step))].sort(
      (a, b) => a - b,
    );
    const stepXml = steps.map((step) => {
      const effects = items.filter((item) => item.step === step);
      const stepId = ids.next();
      const delays = effects.map((item) => {
        const animation = byId.get(item.elementId)?.animation as Animation;
        return item.startMs - animation.delayMs;
      });
      const stepStart = Math.max(0, Math.min(...delays));
      const effectXml = effects.map((item) => {
        const element = byId.get(item.elementId) as SlideElement;
        const animation = element.animation as Animation;
        const spid = shapeIds.get(element.id) as number;
        const preset = PRESETS[animation.effect];
        const effectId = ids.next();
        return `<p:par><p:cTn id="${effectId}" presetID="${preset.id}" presetClass="entr" presetSubtype="${preset.subtype}" fill="hold" grpId="0" nodeType="${NODE_TYPES[animation.trigger]}"><p:stCondLst><p:cond delay="${Math.round(animation.delayMs)}"/></p:stCondLst><p:childTnLst>${behaviours(animation.effect, spid, Math.round(animation.durationMs), ids)}</p:childTnLst></p:cTn></p:par>`;
      });
      return `<p:par><p:cTn id="${stepId}" fill="hold"><p:stCondLst><p:cond delay="${Math.round(stepStart)}"/></p:stCondLst><p:childTnLst>${effectXml.join("")}</p:childTnLst></p:cTn></p:par>`;
    });
    return `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst>${start}</p:stCondLst><p:childTnLst>${stepXml.join("")}</p:childTnLst></p:cTn></p:par>`;
  });
  const builds = schedule
    .map((item) => byId.get(item.elementId) as SlideElement)
    .filter((element) => element.type !== "image" || animBg.has(element.id))
    .map(
      (element) =>
        `<p:bldP spid="${shapeIds.get(element.id)}" grpId="0"${animBg.has(element.id) ? ' animBg="1"' : ""}/>`,
    );
  const sld = "<p:tgtEl><p:sldTgt/></p:tgtEl>";
  return `<p:timing><p:tnLst><p:par><p:cTn id="${root}" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="${main}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${groupXml.join("")}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0">${sld}</p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0">${sld}</p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${builds.length ? `<p:bldLst>${builds.join("")}</p:bldLst>` : ""}</p:timing>`;
}

const GROUP =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

type Media = {
  path: string;
  relTarget: string;
  bytes: Uint8Array;
  frame: Frame;
};

function slideXml(
  slide: Slide,
  deck: Deck,
  options: PptxOptions,
  media: (frame: Frame, key: string) => Media,
): { xml: string; images: { relId: string; media: Media }[] } {
  const shapeIds = new Map<string, number>();
  const animBg = new Set<string>();
  const images: { relId: string; media: Media }[] = [];
  let next = 2;
  const shapes = slide.elements.map((element) => {
    const id = next++;
    shapeIds.set(element.id, id);
    if (element.type === "text") {
      if (element.fill) animBg.add(element.id);
      return textShape(element, id, deck.theme.fonts, deck.theme.colors.accent);
    }
    if (element.type === "shape") {
      animBg.add(element.id);
      return shapeShape(element, id);
    }
    const key = frameKey(element.frameAt);
    const frame = options.frames[key];
    if (!frame) {
      animBg.add(element.id);
      return placeholderShape(element, id, deck);
    }
    const item = media(frame, key);
    const relId = `rId${images.length + 3}`;
    images.push({ relId, media: item });
    return pictureShape(element, id, relId, frame, deck.theme.colors.ink);
  });
  if (!options.approved)
    shapes.push(draftShape(next++, deck.theme.colors.warn));
  const xml = `${HEAD}<p:sld ${PML_NS}><p:cSld><p:bg><p:bgPr>${solid(slide.background)}<a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transitionXml(slide)}${timingXml(slide, shapeIds, animBg)}</p:sld>`;
  return { xml, images };
}

function notesXml(notes: string): string {
  const paragraphs = notes
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="en-GB" dirty="0"/><a:t>${esc(line)}</a:t></a:r></a:p>`,
    )
    .join("");
  return `${HEAD}<p:notes ${PML_NS}><p:cSld><p:spTree>${GROUP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs || '<a:p><a:endParaRPr lang="en-GB" dirty="0"/></a:p>'}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

const CLR_MAP =
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

function notesMasterXml(): string {
  const style = (level: number) =>
    `<a:lvl${level}pPr marL="${(level - 1) * 457200}" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${level}pPr>`;
  return `${HEAD}<p:notesMaster ${PML_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="381000" y="685800"/><a:ext cx="6096000" cy="3429000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4343400"/><a:ext cx="5486400" cy="4114800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-GB"/><a:t>Notes</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>${CLR_MAP}<p:notesStyle>${[1, 2, 3].map(style).join("")}</p:notesStyle></p:notesMaster>`;
}

function themeXml(deck: Deck, name: string): string {
  const c = deck.theme.colors;
  const color = (tag: string, value: string) =>
    `<a:${tag}><a:srgbClr val="${rgb(value)}"/></a:${tag}>`;
  const ph = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const font = (typeface: string) =>
    `<a:latin typeface="${esc(typeface)}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  const line = (w: number) =>
    `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${ph}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  return `${HEAD}<a:theme xmlns:a="${NS.a}" name="${esc(name)}"><a:themeElements><a:clrScheme name="${esc(name)}">${color("dk1", c.ink)}${color("lt1", c.surface)}${color("dk2", c.accent)}${color("lt2", c.background)}${color("accent1", c.accent)}${color("accent2", c.highlight)}${color("accent3", c.accentSoft)}${color("accent4", c.warn)}${color("accent5", c.muted)}${color("accent6", c.ink)}${color("hlink", c.accent)}${color("folHlink", c.muted)}</a:clrScheme><a:fontScheme name="${esc(name)}"><a:majorFont>${font(deck.theme.fonts.heading)}</a:majorFont><a:minorFont>${font(deck.theme.fonts.body)}</a:minorFont></a:fontScheme><a:fmtScheme name="${esc(name)}"><a:fillStyleLst>${ph}${ph}${ph}</a:fillStyleLst><a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${ph}${ph}${ph}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

function masterXml(deck: Deck): string {
  const level = (size: number, face: string) =>
    `<a:lvl1pPr><a:defRPr sz="${size}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="${face}"/></a:defRPr></a:lvl1pPr>`;
  return `${HEAD}<p:sldMaster ${PML_NS}><p:cSld><p:bg><p:bgPr>${solid(deck.theme.colors.background)}<a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld>${CLR_MAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle>${level(3200, "+mj-lt")}</p:titleStyle><p:bodyStyle>${level(2000, "+mn-lt")}</p:bodyStyle><p:otherStyle>${level(1800, "+mn-lt")}</p:otherStyle></p:txStyles></p:sldMaster>`;
}

const LAYOUT_XML = `${HEAD}<p:sldLayout ${PML_NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

function rels(items: { id: string; type: string; target: string }[]): string {
  return `${HEAD}<Relationships xmlns="${NS.rel}">${items
    .map(
      (item) =>
        `<Relationship Id="${item.id}" Type="${item.type}" Target="${esc(item.target)}"/>`,
    )
    .join("")}</Relationships>`;
}

/** W3CDTF without fractions of a second, as Office writes it. */
function w3c(iso: string | undefined): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Builds the PPTX. Pure: the same Deck, Frames and options give the same bytes. */
export function buildPptx(deck: Deck, options: PptxOptions): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, xml: string) => {
    files[path] = strToU8(xml);
  };
  const overrides: { part: string; type: string }[] = [];
  const mediaByKey = new Map<string, Media>();
  const media = (frame: Frame, key: string): Media => {
    const known = mediaByKey.get(key);
    if (known) return known;
    const ext = frame.mime === "image/png" ? "png" : "jpeg";
    const name = `image${mediaByKey.size + 1}.${ext}`;
    const item = {
      path: `ppt/media/${name}`,
      relTarget: `../media/${name}`,
      bytes: frame.bytes,
      frame,
    };
    mediaByKey.set(key, item);
    return item;
  };

  const slideCount = deck.slides.length;
  const presentationRels: { id: string; type: string; target: string }[] = [
    {
      id: "rId1",
      type: `${REL}/slideMaster`,
      target: "slideMasters/slideMaster1.xml",
    },
    {
      id: "rId2",
      type: `${REL}/notesMaster`,
      target: "notesMasters/notesMaster1.xml",
    },
  ];
  const slideIds: string[] = [];
  let notesCount = 0;

  deck.slides.forEach((slide, index) => {
    const n = index + 1;
    const { xml, images } = slideXml(slide, deck, options, media);
    put(`ppt/slides/slide${n}.xml`, xml);
    overrides.push({
      part: `/ppt/slides/slide${n}.xml`,
      type: `${PML}.slide+xml`,
    });
    const slideRels = [
      {
        id: "rId1",
        type: `${REL}/slideLayout`,
        target: "../slideLayouts/slideLayout1.xml",
      },
    ];
    if (slide.notes.trim()) {
      notesCount += 1;
      slideRels.push({
        id: "rId2",
        type: `${REL}/notesSlide`,
        target: `../notesSlides/notesSlide${n}.xml`,
      });
      put(`ppt/notesSlides/notesSlide${n}.xml`, notesXml(slide.notes));
      put(
        `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`,
        rels([
          {
            id: "rId1",
            type: `${REL}/notesMaster`,
            target: "../notesMasters/notesMaster1.xml",
          },
          {
            id: "rId2",
            type: `${REL}/slide`,
            target: `../slides/slide${n}.xml`,
          },
        ]),
      );
      overrides.push({
        part: `/ppt/notesSlides/notesSlide${n}.xml`,
        type: `${PML}.notesSlide+xml`,
      });
    }
    for (const image of images) {
      slideRels.push({
        id: image.relId,
        type: `${REL}/image`,
        target: image.media.relTarget,
      });
    }
    put(`ppt/slides/_rels/slide${n}.xml.rels`, rels(slideRels));
    const relId = `rId${n + 2}`;
    presentationRels.push({
      id: relId,
      type: `${REL}/slide`,
      target: `slides/slide${n}.xml`,
    });
    slideIds.push(`<p:sldId id="${255 + n}" r:id="${relId}"/>`);
  });

  const tail = slideCount + 3;
  presentationRels.push(
    { id: `rId${tail}`, type: `${REL}/presProps`, target: "presProps.xml" },
    { id: `rId${tail + 1}`, type: `${REL}/viewProps`, target: "viewProps.xml" },
    { id: `rId${tail + 2}`, type: `${REL}/theme`, target: "theme/theme1.xml" },
    {
      id: `rId${tail + 3}`,
      type: `${REL}/tableStyles`,
      target: "tableStyles.xml",
    },
  );

  for (const item of mediaByKey.values()) files[item.path] = item.bytes;

  put(
    "ppt/presentation.xml",
    `${HEAD}<p:presentation ${PML_NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst>${slideIds.length ? `<p:sldIdLst>${slideIds.join("")}</p:sldIdLst>` : ""}<p:sldSz cx="${emu(SLIDE_W)}" cy="${emu(SLIDE_H)}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-GB"/></a:defPPr></p:defaultTextStyle></p:presentation>`,
  );
  put("ppt/_rels/presentation.xml.rels", rels(presentationRels));
  put("ppt/slideMasters/slideMaster1.xml", masterXml(deck));
  put(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    rels([
      {
        id: "rId1",
        type: `${REL}/slideLayout`,
        target: "../slideLayouts/slideLayout1.xml",
      },
      { id: "rId2", type: `${REL}/theme`, target: "../theme/theme1.xml" },
    ]),
  );
  put("ppt/slideLayouts/slideLayout1.xml", LAYOUT_XML);
  put(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    rels([
      {
        id: "rId1",
        type: `${REL}/slideMaster`,
        target: "../slideMasters/slideMaster1.xml",
      },
    ]),
  );
  put("ppt/notesMasters/notesMaster1.xml", notesMasterXml());
  put(
    "ppt/notesMasters/_rels/notesMaster1.xml.rels",
    rels([{ id: "rId1", type: `${REL}/theme`, target: "../theme/theme2.xml" }]),
  );
  put("ppt/theme/theme1.xml", themeXml(deck, "Process transfer"));
  put("ppt/theme/theme2.xml", themeXml(deck, "Process transfer notes"));
  put("ppt/presProps.xml", `${HEAD}<p:presentationPr ${PML_NS}/>`);
  put(
    "ppt/viewProps.xml",
    `${HEAD}<p:viewPr ${PML_NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`,
  );
  put(
    "ppt/tableStyles.xml",
    `${HEAD}<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
  );

  const created = w3c(options.createdAt);
  const stamp = created
    ? `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>`
    : "";
  put(
    "docProps/core.xml",
    `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(deck.title)}</dc:title>${options.author ? `<dc:creator>${esc(options.author)}</dc:creator><cp:lastModifiedBy>${esc(options.author)}</cp:lastModifiedBy>` : ""}${stamp}</cp:coreProperties>`,
  );
  put(
    "docProps/app.xml",
    `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Process transfer</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${slideCount}</Slides><Notes>${notesCount}</Notes></Properties>`,
  );
  put(
    "_rels/.rels",
    rels([
      {
        id: "rId1",
        type: `${REL}/officeDocument`,
        target: "ppt/presentation.xml",
      },
      {
        id: "rId2",
        type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        target: "docProps/core.xml",
      },
      {
        id: "rId3",
        type: `${REL}/extended-properties`,
        target: "docProps/app.xml",
      },
    ]),
  );

  overrides.push(
    { part: "/ppt/presentation.xml", type: `${PML}.presentation.main+xml` },
    {
      part: "/ppt/slideMasters/slideMaster1.xml",
      type: `${PML}.slideMaster+xml`,
    },
    {
      part: "/ppt/slideLayouts/slideLayout1.xml",
      type: `${PML}.slideLayout+xml`,
    },
    {
      part: "/ppt/notesMasters/notesMaster1.xml",
      type: `${PML}.notesMaster+xml`,
    },
    {
      part: "/ppt/theme/theme1.xml",
      type: "application/vnd.openxmlformats-officedocument.theme+xml",
    },
    {
      part: "/ppt/theme/theme2.xml",
      type: "application/vnd.openxmlformats-officedocument.theme+xml",
    },
    { part: "/ppt/presProps.xml", type: `${PML}.presProps+xml` },
    { part: "/ppt/viewProps.xml", type: `${PML}.viewProps+xml` },
    { part: "/ppt/tableStyles.xml", type: `${PML}.tableStyles+xml` },
    {
      part: "/docProps/core.xml",
      type: "application/vnd.openxmlformats-package.core-properties+xml",
    },
    {
      part: "/docProps/app.xml",
      type: "application/vnd.openxmlformats-officedocument.extended-properties+xml",
    },
  );
  const contentTypes = `${HEAD}<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>${overrides
    .map(
      (item) =>
        `<Override PartName="${item.part}" ContentType="${item.type}"/>`,
    )
    .join("")}</Types>`;

  const mtime = created ?? "1980-01-01T00:00:00Z";
  const zippable: Zippable = {
    "[Content_Types].xml": [strToU8(contentTypes), { mtime }],
  };
  for (const [path, bytes] of Object.entries(files)) {
    const stored = path.startsWith("ppt/media/");
    zippable[path] = [bytes, { level: stored ? 0 : 6, mtime }];
  }
  return zipSync(zippable);
}
