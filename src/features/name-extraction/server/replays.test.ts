import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Replay } from "../domain/contract";
import { corpusEntry } from "../domain/corpus";
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
