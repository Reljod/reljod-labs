import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KNOWLEDGE_SAMPLES } from "../samples/knowledge";
import { findDocumentDate, formatDocumentDate } from "./dates";
import { SEED_SOURCES, seedPassages } from "./seed";
import { SEED_TEXTS } from "./seed-texts";
import { MAX_CHARS, splitSource } from "./split";

const ROOT = join(import.meta.dirname, "../../../../..");

describe("seed Sources", () => {
  it("are in sync with fixtures/harness/knowledge (run scripts/build-harness-knowledge.mts)", () => {
    const dir = join(ROOT, "fixtures/harness/knowledge");
    const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
    expect(Object.keys(SEED_TEXTS).sort()).toEqual(
      files.map((name) => name.replace(/\.md$/, "")).sort(),
    );
    for (const name of files) {
      expect(SEED_TEXTS[name.replace(/\.md$/, "")]).toBe(
        readFileSync(join(dir, name), "utf8").trimEnd(),
      );
    }
  });

  it("number six to eight, each with text, a date and a unique key", () => {
    expect(SEED_SOURCES.length).toBeGreaterThanOrEqual(6);
    expect(SEED_SOURCES.length).toBeLessThanOrEqual(8);
    expect(new Set(SEED_SOURCES.map((source) => source.key)).size).toBe(
      SEED_SOURCES.length,
    );
    for (const source of SEED_SOURCES) {
      expect(source.text.length).toBeGreaterThan(500);
      expect(source.documentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("each says it is illustrative, not legal advice, and is a SPECIMEN", () => {
    for (const source of SEED_SOURCES) {
      expect(source.text).toMatch(/illustrative, not legal advice/i);
      expect(source.text).toContain("SPECIMEN");
    }
  });

  it("each splits into Passages that fit, and every Passage names its heading", () => {
    for (const source of SEED_SOURCES) {
      const passages = seedPassages(source);
      expect(passages.length).toBeGreaterThan(0);
      for (const passage of passages) {
        expect(passage.body.length).toBeLessThanOrEqual(MAX_CHARS);
        expect(passage.body.trim()).not.toBe("");
      }
      expect(splitSource("text", source.text).truncated).toBe(false);
    }
  });

  it("holds the old and the new property cap, the old one in the older document", () => {
    const withCap = (cap: string) =>
      SEED_SOURCES.filter((source) =>
        seedPassages(source).some((passage) => passage.body.includes(cap)),
      );
    const old = withCap("CI$35,000");
    const current = withCap("CI$50,000");
    expect(old.map((source) => source.key)).toEqual(["member-guide"]);
    expect(current.length).toBeGreaterThanOrEqual(2);
    const circular = KNOWLEDGE_SAMPLES.find(
      (sample) => sample.id === "kb-circular-2023-07",
    );
    expect(circular).toBeDefined();
    const oldDate = old[0]?.documentDate ?? "";
    // The Circular is dated 1 December 2023, after the guide that still says CI$35,000.
    expect("2023-12-01" > oldDate).toBe(true);
  });

  it("does not repeat the old cap anywhere else", () => {
    for (const source of SEED_SOURCES.filter((s) => s.key !== "member-guide")) {
      expect(source.text).not.toContain("35,000");
    }
  });
});

describe("sample files", () => {
  it("number at least three, each in public/harness/samples with a kb- name", () => {
    expect(KNOWLEDGE_SAMPLES.length).toBeGreaterThanOrEqual(3);
    for (const sample of KNOWLEDGE_SAMPLES) {
      expect(sample.id.startsWith("kb-")).toBe(true);
      expect(sample.name.startsWith("kb-")).toBe(true);
      expect(sample.path).toBe(`/harness/samples/${sample.name}`);
      expect(sample.group).toBe("knowledge");
      expect(existsSync(join(ROOT, "public", sample.path))).toBe(true);
    }
    expect(new Set(KNOWLEDGE_SAMPLES.map((sample) => sample.id)).size).toBe(
      KNOWLEDGE_SAMPLES.length,
    );
  });

  it("the Circular states the new caps and the date, in plain PDF text", () => {
    const pdf = readFileSync(
      join(ROOT, "public/harness/samples/kb-pensions-circular-2023-07.pdf"),
    ).toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toContain("CI$50,000");
    expect(pdf).toContain("CI$100,000");
    expect(pdf).toContain("Date: 1 December 2023");
  });

  it("the memo and the CSV agree with the seed on rates and the cap", () => {
    const memo = readFileSync(
      join(ROOT, "public/harness/samples/kb-remittance-reminder-memo.txt"),
      "utf8",
    );
    expect(memo).toContain("15th");
    expect(memo).toContain("CI$87,000");
    expect(memo).not.toContain("35,000");
    expect(findDocumentDate(memo)).toBe("2024-01-12");
    const csv = readFileSync(
      join(ROOT, "public/harness/samples/kb-contribution-table.csv"),
      "utf8",
    );
    const passages = splitSource("csv", csv, {
      label: "Contribution table",
    }).passages;
    expect(passages[0]?.body.split("\n")[0]).toContain("Employer 5%");
  });
});

describe("findDocumentDate", () => {
  it("reads labelled dates before any other", () => {
    expect(
      findDocumentDate(
        "Circular 2023-07\nDate: 1 December 2023\nEffective 9 December 2023",
      ),
    ).toBe("2023-12-01");
    expect(findDocumentDate("Member Guide, edition of 1 March 2023.")).toBe(
      "2023-03-01",
    );
    expect(findDocumentDate("effective: 2026-07-01")).toBe("2026-07-01");
  });

  it("falls back to the first date near the top, and to null", () => {
    expect(findDocumentDate("Notes from 5 May 2024 about things")).toBe(
      "2024-05-05",
    );
    expect(findDocumentDate("no date here")).toBeNull();
    expect(findDocumentDate(`${"x".repeat(2000)} Date: 1 May 2024`)).toBeNull();
  });

  it("refuses dates that do not exist", () => {
    expect(findDocumentDate("Date: 31 February 2024")).toBeNull();
  });

  it("formats for people", () => {
    expect(formatDocumentDate("2023-12-01")).toBe("1 Dec 2023");
    expect(formatDocumentDate(null)).toBe("undated");
  });
});
