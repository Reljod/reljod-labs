import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareNames } from "./compare";
import { DEFAULT_RULEBOOK, type Replay } from "./contract";
import {
  answerKeyFor,
  corpusEntry,
  generateDocument,
  generateDocumentDetailed,
} from "./corpus";
import { REPLAYS } from "./replays";

const PUBLIC = join(process.cwd(), "public");

describe("REPLAYS", () => {
  for (const item of REPLAYS) {
    it(`${item.corpusId} is shipped, small and matches its corpus entry`, () => {
      const file = join(PUBLIC, item.path);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeLessThan(600_000);
      const replay = JSON.parse(readFileSync(file, "utf8")) as Replay;
      const entry = corpusEntry(item.corpusId);
      expect(entry.featured).toBe(true);
      expect(item.title).toBe(entry.title);
      expect(replay.corpusId).toBe(item.corpusId);
      expect(replay.pages).toBe(item.pages);
      expect(replay.events[0].type).toBe("start");
      expect(replay.events.at(-1)?.type).toBe("end");
      expect(replay.comparison.score).not.toBeNull();
      const seqs = replay.events.map((e) => e.seq);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    });
  }
});

/** Whitespace runs folded to one space, so a quote wrapped over a line still matches. */
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

describe("REPLAYS against the corpus they were recorded on", () => {
  for (const item of REPLAYS) {
    const replay = () =>
      JSON.parse(readFileSync(join(PUBLIC, item.path), "utf8")) as Replay;

    it(`${item.corpusId}'s stored comparison is the one compareRun would show`, () => {
      const { names, comparison } = replay();
      const { answerKey, hard } = generateDocumentDetailed(item.corpusId);
      expect(comparison).toEqual(
        compareNames(
          names,
          answerKeyFor(answerKey, DEFAULT_RULEBOOK),
          new Map(hard.map((party) => [party.canonical, party.kind] as const)),
        ),
      );
    });

    it(`${item.corpusId}'s every quote is still printed on its page`, () => {
      const pages = generateDocument(item.corpusId).document.pages.map(squash);
      const stray = replay().names.flatMap((name) =>
        name.mentions
          .filter((m) => !pages[m.page - 1]?.includes(squash(m.quote)))
          .map((m) => `${name.canonical} p${m.page}: ${m.quote}`),
      );
      expect(stray).toEqual([]);
    });
  }
});
