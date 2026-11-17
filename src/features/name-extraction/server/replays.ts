/**
 * The recorded Runs shipped as static JSON (a `Replay` each, see
 * domain/contract.ts), written by `scripts/eval-name-extraction.mts <id> --record`.
 * Client-safe: plain data, no server import. Add a line when you record one.
 */
export const REPLAYS: {
  corpusId: string;
  path: string;
  title: string;
  pages: number;
}[] = [
  {
    corpusId: "ne-tr-11",
    path: "/name-extraction/replays/ne-tr-11.json",
    title: "Correspondent banking payments archive, FY2025",
    pages: 500,
  },
  {
    corpusId: "ne-tr-05",
    path: "/name-extraction/replays/ne-tr-05.json",
    title: "Commercial Court judgment on a tracing claim",
    pages: 100,
  },
];
