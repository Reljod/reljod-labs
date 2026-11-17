/**
 * The Name Extraction Corpus: synthetic AML Documents set in the fictional
 * Republic of Meridia, generated from a seed (never stored), each with an
 * exact Answer key. Tune on train and validation only; the test split is for
 * reporting. See fixtures/name-extraction/README.md.
 */
import type { CorpusCard, DocumentText, Rulebook, Split } from "../contract";
import {
  type ExpectedName,
  type GeneratedDocument,
  generate,
  planParties,
} from "./generate";
import { GENRES } from "./genres";

export type { ExpectedName } from "./generate";

export type CorpusEntry = {
  id: string;
  title: string;
  genre: string;
  pages: number;
  split: Split;
  seed: number;
  description: string;
};

const entry = (
  id: string,
  split: Split,
  genre: keyof typeof GENRES,
  pages: number,
  seed: number,
  title: string,
  description: string,
): CorpusEntry => ({
  id,
  title,
  genre: GENRES[genre].label,
  pages,
  split,
  seed,
  description,
});

export const CORPUS: CorpusEntry[] = [
  // train
  entry(
    "ne-tr-01",
    "train",
    "wire",
    10,
    1101,
    "Harbour corridor MT103 batch",
    "Ten pages of outgoing SWIFT messages and a payments ledger from the Port Selene desk.",
  ),
  entry(
    "ne-tr-02",
    "train",
    "statement",
    25,
    1102,
    "Freight forwarder current account",
    "Monthly statements of a freight forwarder with round-sum transfers in and out.",
  ),
  entry(
    "ne-tr-03",
    "train",
    "kyc",
    50,
    1103,
    "Private client onboarding file",
    "Customer due diligence for a high-net-worth customer: profile, related parties, certified copies.",
  ),
  entry(
    "ne-tr-04",
    "train",
    "registry",
    75,
    1104,
    "Layered holding structure extract",
    "Registry extracts for a chain of holding companies, nominee shareholders and declared owners.",
  ),
  entry(
    "ne-tr-05",
    "train",
    "judgment",
    100,
    1105,
    "Tracing claim over mixed accounts",
    "A commercial court judgment following funds through nominee and company accounts.",
  ),
  entry(
    "ne-tr-06",
    "train",
    "sar",
    150,
    1106,
    "Structured cash deposits review",
    "An internal suspicious activity review of structured deposits and onward transfers.",
  ),
  entry(
    "ne-tr-07",
    "train",
    "comms",
    200,
    1107,
    "Shipping desk mailbox export",
    "Emails and chat messages between a trading desk, shippers and intermediaries.",
  ),
  entry(
    "ne-tr-08",
    "train",
    "tradefinance",
    250,
    1108,
    "Seafood import credit file",
    "Letters of credit, bills of lading and signed presentations for a seafood importer.",
  ),
  entry(
    "ne-tr-09",
    "train",
    "minutes",
    300,
    1109,
    "Shipping group board minutes",
    "Two years of board minutes: appointments, interests declared and related-party loans.",
  ),
  entry(
    "ne-tr-10",
    "train",
    "statement",
    400,
    1110,
    "Trading company statements, 2025-2026",
    "A long run of statements where most pages are routine and a few carry the counterparties.",
  ),
  entry(
    "ne-tr-11",
    "train",
    "wire",
    500,
    1111,
    "Correspondent banking payments archive",
    "Five hundred pages of MT103 traffic; the names cluster in a few sections.",
  ),
  entry(
    "ne-tr-12",
    "train",
    "kyc",
    25,
    1112,
    "Corporate customer periodic review",
    "A periodic review of a corporate customer with signatories and an introducer.",
  ),
  entry(
    "ne-tr-13",
    "train",
    "sar",
    10,
    1113,
    "Rapid movement of funds alert",
    "A short alert narrative about funds moving through three accounts in two days.",
  ),
  // validation
  entry(
    "ne-va-01",
    "validation",
    "registry",
    10,
    2101,
    "Shelf company extract",
    "A short registry extract for a recently bought shelf company.",
  ),
  entry(
    "ne-va-02",
    "validation",
    "comms",
    50,
    2102,
    "Broker chat review set",
    "Chat and email between a broker, a buyer and a nominee director.",
  ),
  entry(
    "ne-va-03",
    "validation",
    "minutes",
    100,
    2103,
    "Property company board minutes",
    "Board minutes of a property company with loans from connected parties.",
  ),
  entry(
    "ne-va-04",
    "validation",
    "judgment",
    150,
    2104,
    "Asset recovery judgment",
    "A judgment on recovering the proceeds of an invoice fraud.",
  ),
  entry(
    "ne-va-05",
    "validation",
    "wire",
    300,
    2105,
    "Remittance hub ledger",
    "A remittance hub's ledger of MT103 messages and returns.",
  ),
  entry(
    "ne-va-06",
    "validation",
    "tradefinance",
    500,
    2106,
    "Commodity trader credit archive",
    "Five hundred pages of documentary credits, bills of lading and discrepancy notices.",
  ),
  entry(
    "ne-va-07",
    "validation",
    "kyc",
    75,
    2107,
    "Trust and foundation onboarding",
    "Onboarding of a family trust and a foundation with their settlors and protectors.",
  ),
  // test
  entry(
    "ne-te-01",
    "test",
    "kyc",
    10,
    3101,
    "Retail customer onboarding",
    "Ten pages of onboarding for a retail customer with two related parties.",
  ),
  entry(
    "ne-te-02",
    "test",
    "sar",
    25,
    3102,
    "Mule account cluster",
    "A narrative about a cluster of accounts used to pass on fraud proceeds.",
  ),
  entry(
    "ne-te-03",
    "test",
    "minutes",
    75,
    3103,
    "Logistics group minutes",
    "Board minutes of a logistics group, with conflicts of interest and resignations.",
  ),
  entry(
    "ne-te-04",
    "test",
    "registry",
    100,
    3104,
    "Offshore chain registry pack",
    "Registry extracts for a chain of companies ending in a trust.",
  ),
  entry(
    "ne-te-05",
    "test",
    "comms",
    250,
    3105,
    "Trade desk eDiscovery set",
    "A review set from a trade desk mailbox, with nicknames and handles.",
  ),
  entry(
    "ne-te-06",
    "test",
    "statement",
    500,
    3106,
    "Import business statements archive",
    "Five hundred pages of statements; most counterparties appear only in a few sections.",
  ),
  entry(
    "ne-te-07",
    "test",
    "judgment",
    200,
    3107,
    "Nominee director judgment",
    "A judgment on nominee directors who signed for an absent owner.",
  ),
];

const GENRE_BY_LABEL = new Map(
  Object.entries(GENRES).map(([key, genre]) => [genre.label, key]),
);

function input(entry: CorpusEntry) {
  return {
    id: entry.id,
    title: entry.title,
    genre: GENRE_BY_LABEL.get(entry.genre) ?? entry.genre,
    pages: entry.pages,
    seed: entry.seed,
  };
}

export function corpusEntry(id: string): CorpusEntry {
  const found = CORPUS.find((e) => e.id === id);
  if (!found) throw new Error(`Unknown corpus document: ${id}`);
  return found;
}

/** The Document and its Answer key, plus what was printed where (for tests and rendering). */
export function generateDocumentDetailed(id: string): GeneratedDocument {
  return generate(input(corpusEntry(id)));
}

export function generateDocument(id: string): {
  document: DocumentText;
  answerKey: ExpectedName[];
} {
  const { document, answerKey } = generateDocumentDetailed(id);
  return { document, answerKey };
}

/**
 * The Answer key a Run under this Rulebook should reach: names printed only
 * as an email address count only when the Rulebook includes handles.
 */
export function answerKeyFor(
  answerKey: ExpectedName[],
  rulebook: Pick<Rulebook, "includeHandles">,
): ExpectedName[] {
  return rulebook.includeHandles
    ? answerKey
    : answerKey.filter((name) => !name.handleOnly);
}

export function corpusCards(): CorpusCard[] {
  return CORPUS.map((e) => ({
    id: e.id,
    title: e.title,
    genre: e.genre,
    pages: e.pages,
    split: e.split,
    description: e.description,
    expectedNames: planParties(input(e)).parties.length,
  }));
}
