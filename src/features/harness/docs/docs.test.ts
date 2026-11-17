import { describe, expect, it } from "vitest";
import {
  allHeadings,
  docParamOf,
  linkAddresses,
  neighbours,
  outlineOf,
  pageBlocks,
  pageText,
  parseDocLink,
  parseDocParam,
  searchPages,
} from "./lib";
import { liveMarkdown, table } from "./live";
import { FIRST_PAGE_ID, PAGES, pageById, SECTIONS } from "./registry";
import { type DocPage, type LiveId, SECTION_IDS } from "./types";

const fake = (id: string, title: string, text: string): DocPage => ({
  id,
  section: "concepts",
  title,
  summary: `About ${title}.`,
  body: [text],
});

describe("the registry", () => {
  it("has unique page ids in kebab case", () => {
    const ids = PAGES.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("lists every page in the navigation once, and every entry has a page", () => {
    const listed = SECTIONS.flatMap((section) => section.pages);
    expect(new Set(listed).size).toBe(listed.length);
    for (const id of listed) expect(pageById(id), id).not.toBeNull();
    expect([...listed].sort()).toEqual(PAGES.map((page) => page.id).sort());
  });

  it("puts each page in the section that lists it", () => {
    for (const section of SECTIONS) {
      for (const id of section.pages) {
        expect(pageById(id)?.section, id).toBe(section.id);
      }
    }
    expect(SECTIONS.map((section) => section.id)).toEqual([...SECTION_IDS]);
  });

  it("opens on a page that exists", () => {
    expect(pageById(FIRST_PAGE_ID)).not.toBeNull();
  });

  it("has no empty page", () => {
    for (const page of PAGES) {
      expect(page.title.trim(), page.id).not.toBe("");
      expect(page.summary.trim(), page.id).not.toBe("");
      expect(page.body.length, page.id).toBeGreaterThan(0);
      expect(pageText(page).trim().length, page.id).toBeGreaterThan(200);
    }
  });

  it("resolves every internal link, and every heading it names", () => {
    for (const page of PAGES) {
      for (const text of pageBlocks(page)) {
        for (const href of linkAddresses(text)) {
          const link = parseDocLink(href);
          if (link?.kind === "doc") {
            const target = pageById(link.id);
            expect(target, `${page.id} links to doc:${link.id}`).not.toBeNull();
            if (target && link.anchor) {
              const slugs = allHeadings(target).map((heading) => heading.slug);
              expect(
                slugs,
                `${page.id} -> ${link.id}#${link.anchor}`,
              ).toContain(link.anchor);
            }
          } else if (link?.kind === "anchor") {
            const slugs = allHeadings(page).map((heading) => heading.slug);
            expect(slugs, `${page.id} -> #${link.slug}`).toContain(link.slug);
          } else if (link?.kind === "tab") {
            expect(link.tab).toBeTruthy();
          } else if (href.startsWith("#")) {
            throw new Error(
              `${page.id} has a link that opens nothing: ${href}`,
            );
          }
        }
      }
    }
  });

  it("gives a page no h1 and no repeated heading, so anchors are stable", () => {
    for (const page of PAGES) {
      const headings = allHeadings(page);
      expect(
        headings.filter((heading) => heading.level === 1),
        page.id,
      ).toEqual([]);
      const slugs = headings.map((heading) => heading.slug);
      expect(new Set(slugs).size, `${page.id}: ${slugs.join(", ")}`).toBe(
        slugs.length,
      );
    }
  });

  it("writes no stand-in character where a backtick belongs", () => {
    for (const page of PAGES)
      expect(pageText(page), page.id).not.toContain("§");
  });

  it("keeps the glossary's word choices on the pages", () => {
    // The glossary lists the words not to use, so it names them.
    const text = PAGES.filter((page) => page.id !== "ref-glossary")
      .map(pageText)
      .join("\n");
    expect(text).not.toMatch(/\bthread\b/i);
    expect(text).not.toMatch(/\bco-?pilot\b/i);
  });
});

describe("live tables", () => {
  const ids: LiveId[] = [
    "mcp-tools",
    "permissions",
    "pipelines",
    "pipeline-inputs",
    "pipeline-steps",
    "rules",
    "skills",
    "skill-limits",
    "audit-actions",
    "limits",
    "routes",
    "sandbox-limits",
    "staff",
    "outcomes",
    "run-statuses",
    "member-request-kinds",
  ];

  it("builds from the registries without throwing, even when they are empty", () => {
    for (const id of ids) {
      expect(liveMarkdown(id, "member_request").length, id).toBeGreaterThan(0);
    }
  });

  it("lists every audit action and every route", () => {
    expect(liveMarkdown("audit-actions")).toContain("approval.decided");
    expect(liveMarkdown("routes")).toContain("/api/harness/runs/[id]/events");
  });

  it("shows the permission matrix from the code", () => {
    const matrix = liveMarkdown("permissions");
    expect(matrix).toMatch(/approval\.decide\.high`[^\n]*\| No \| Yes \|/);
    expect(matrix).toMatch(/run\.start`[^\n]*\| Yes \| Yes \|/);
  });

  it("escapes pipes and line breaks in a cell", () => {
    expect(table(["a"], [["x | y\nz"]])).toBe("| a |\n| --- |\n| x \\| y z |");
  });
});

describe("search", () => {
  const pages = [
    fake("a", "Skills", "Instructions the Agent loads."),
    fake("b", "Audit trail", "Every action is recorded. Skills are saved too."),
    fake("c", "Sandbox", "A container for code."),
  ];

  it("returns every page for an empty query", () => {
    expect(searchPages(pages, "  ")).toEqual(pages);
  });

  it("finds words in the body, ignoring case", () => {
    expect(searchPages(pages, "CONTAINER").map((page) => page.id)).toEqual([
      "c",
    ]);
  });

  it("ranks a title match before a body match", () => {
    expect(searchPages(pages, "skills").map((page) => page.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("needs every word", () => {
    expect(searchPages(pages, "skills container")).toEqual([]);
    expect(searchPages(pages, "audit recorded").map((page) => page.id)).toEqual(
      ["b"],
    );
  });

  it("finds a real page by its title and by live text", () => {
    expect(searchPages(PAGES, "Approvals and four-eyes")[0]?.id).toBe(
      "approvals",
    );
    expect(searchPages(PAGES, "approval.decided").length).toBeGreaterThan(0);
  });
});

describe("outline", () => {
  it("lists h2 and h3 in order across blocks, with the anchors the page gets", () => {
    const page: DocPage = {
      ...fake("x", "X", ""),
      body: [
        "intro\n\n## First\n\ntext\n\n### Inner `code`\n\n#### Deep",
        { diagram: "architecture" },
        "## Second",
      ],
    };
    expect(outlineOf(page)).toEqual([
      { level: 2, text: "First", slug: "first" },
      { level: 3, text: "Inner code", slug: "inner-code" },
      { level: 2, text: "Second", slug: "second" },
    ]);
  });

  it("gives every real page a non-empty outline", () => {
    for (const page of PAGES)
      expect(outlineOf(page).length, page.id).toBeGreaterThan(0);
  });
});

describe("links and neighbours", () => {
  it("reads the doc parameter", () => {
    expect(parseDocParam("skills#versions")).toEqual({
      id: "skills",
      anchor: "versions",
    });
    expect(parseDocParam("skills")).toEqual({ id: "skills", anchor: null });
    expect(parseDocParam(null)).toEqual({ id: "", anchor: null });
    expect(docParamOf("skills", "versions")).toBe("skills#versions");
    expect(docParamOf("skills")).toBe("skills");
  });

  it("reads the three kinds of in-doc link", () => {
    expect(parseDocLink("#doc:skills")).toEqual({
      kind: "doc",
      id: "skills",
      anchor: null,
    });
    expect(parseDocLink("#doc:skills#versions")).toEqual({
      kind: "doc",
      id: "skills",
      anchor: "versions",
    });
    expect(parseDocLink("#tab:skills?skill=member-request")).toEqual({
      kind: "tab",
      tab: "skills",
      params: { skill: "member-request" },
    });
    expect(parseDocLink("#tab:nowhere")).toBeNull();
    expect(parseDocLink("#overview")).toEqual({
      kind: "anchor",
      slug: "overview",
    });
    expect(parseDocLink("/demos/harness/mcp")).toBeNull();
    expect(parseDocLink("https://example.com")).toBeNull();
  });

  it("steps through the reading order", () => {
    const first = SECTIONS[0]?.pages[0] as string;
    const second = SECTIONS[0]?.pages[1] as string;
    expect(neighbours(SECTIONS, PAGES, first).previous).toBeNull();
    expect(neighbours(SECTIONS, PAGES, first).next?.id).toBe(second);
    expect(neighbours(SECTIONS, PAGES, second).previous?.id).toBe(first);
    const last = SECTIONS.at(-1)?.pages.at(-1) as string;
    expect(neighbours(SECTIONS, PAGES, last).next).toBeNull();
  });
});
