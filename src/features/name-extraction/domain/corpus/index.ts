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
  /** One plain sentence for the card. */
  description: string;
  /** Shown first in the picker; see FEATURED. */
  featured: boolean;
};

/**
 * The Documents the picker shows first: one per genre, from 10 to 500 pages.
 * The page's recorded replays come from these (public/name-extraction/replays).
 */
export const FEATURED: readonly string[] = [
  "ne-te-01",
  "ne-tr-02",
  "ne-va-02",
  "ne-tr-04",
  "ne-tr-05",
  "ne-tr-06",
  "ne-tr-08",
  "ne-tr-09",
  "ne-tr-11",
];

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
  featured: FEATURED.includes(id),
});

export const CORPUS: CorpusEntry[] = [
  // train
  entry(
    "ne-tr-01",
    "train",
    "wire",
    10,
    1101,
    "Outgoing SWIFT payments batch, March 2026",
    "Ten pages of outgoing MT103 payment messages and the payments ledger from one day at the harbour desk.",
  ),
  entry(
    "ne-tr-02",
    "train",
    "statement",
    25,
    1102,
    "Freight forwarder current account statements, 2025",
    "A year of monthly statements for a freight forwarder, with round-sum transfers in and out.",
  ),
  entry(
    "ne-tr-03",
    "train",
    "kyc",
    50,
    1103,
    "Private client onboarding file",
    "Due diligence on a wealthy private client: profile, related parties and certified copies.",
  ),
  entry(
    "ne-tr-04",
    "train",
    "registry",
    75,
    1104,
    "Holding company registry extracts",
    "Registry extracts for a chain of holding companies, with nominee shareholders and declared owners.",
  ),
  entry(
    "ne-tr-05",
    "train",
    "judgment",
    100,
    1105,
    "Commercial Court judgment on a tracing claim",
    "A judgment that follows stolen funds through nominee and company accounts.",
  ),
  entry(
    "ne-tr-06",
    "train",
    "sar",
    150,
    1106,
    "Suspicious activity review: structured cash deposits",
    "An internal review of cash deposits kept under the reporting limit and moved on.",
  ),
  entry(
    "ne-tr-07",
    "train",
    "comms",
    200,
    1107,
    "Shipping desk mailbox export, Q3 2025",
    "Emails and chat messages between a trading desk, shippers and intermediaries.",
  ),
  entry(
    "ne-tr-08",
    "train",
    "tradefinance",
    250,
    1108,
    "Seafood importer letters of credit, 2025",
    "Letters of credit, bills of lading and signed presentations for a seafood importer.",
  ),
  entry(
    "ne-tr-09",
    "train",
    "minutes",
    300,
    1109,
    "Shipping group board minutes, 2024-2025",
    "Two years of board minutes: appointments, declared interests and loans between related parties.",
  ),
  entry(
    "ne-tr-10",
    "train",
    "statement",
    400,
    1110,
    "Trading company bank statements, 2025-2026",
    "A long run of statements where most pages are routine and a few carry the counterparties.",
  ),
  entry(
    "ne-tr-11",
    "train",
    "wire",
    500,
    1111,
    "Correspondent banking payments archive, FY2025",
    "A year of cross-border payment messages; the names cluster in a few sections.",
  ),
  entry(
    "ne-tr-12",
    "train",
    "kyc",
    25,
    1112,
    "Corporate customer periodic review, 2026",
    "A periodic review of a business customer, its signatories and the person who introduced it.",
  ),
  entry(
    "ne-tr-13",
    "train",
    "sar",
    10,
    1113,
    "Transaction monitoring alert: rapid movement of funds",
    "A short alert about money passing through three accounts in two days.",
  ),
  // validation
  entry(
    "ne-va-01",
    "validation",
    "registry",
    10,
    2101,
    "Shelf company registry extract",
    "A short registry extract for a ready-made company that was recently bought.",
  ),
  entry(
    "ne-va-02",
    "validation",
    "comms",
    50,
    2102,
    "Broker chat and email review set",
    "Chat and email between a broker, a buyer and a nominee director.",
  ),
  entry(
    "ne-va-03",
    "validation",
    "minutes",
    100,
    2103,
    "Property company board minutes, 2025",
    "Board minutes of a property company that borrowed from connected parties.",
  ),
  entry(
    "ne-va-04",
    "validation",
    "judgment",
    150,
    2104,
    "High Court judgment: invoice fraud recovery",
    "A judgment on recovering the proceeds of an invoice fraud.",
  ),
  entry(
    "ne-va-05",
    "validation",
    "wire",
    300,
    2105,
    "Remittance hub payments ledger, H1 2026",
    "Six months of a money-transfer business's payment messages and returns.",
  ),
  entry(
    "ne-va-06",
    "validation",
    "tradefinance",
    500,
    2106,
    "Commodity trader documentary credits archive, 2024-2026",
    "Letters of credit, bills of lading and discrepancy notices for a commodity trader.",
  ),
  entry(
    "ne-va-07",
    "validation",
    "kyc",
    75,
    2107,
    "Family trust and foundation onboarding file",
    "Onboarding of a family trust and a foundation, with the people who set up and oversee them.",
  ),
  // test
  entry(
    "ne-te-01",
    "test",
    "kyc",
    10,
    3101,
    "Retail customer account-opening file",
    "Account opening for a personal customer and two people connected to them.",
  ),
  entry(
    "ne-te-02",
    "test",
    "sar",
    25,
    3102,
    "Suspicious activity report: money mule accounts",
    "A report on a group of accounts used to pass on fraud proceeds.",
  ),
  entry(
    "ne-te-03",
    "test",
    "minutes",
    75,
    3103,
    "Logistics group board minutes, 2025",
    "Board minutes of a logistics group, with conflicts of interest and resignations.",
  ),
  entry(
    "ne-te-04",
    "test",
    "registry",
    100,
    3104,
    "Offshore company chain registry pack",
    "Registry extracts for a chain of offshore companies that ends in a trust.",
  ),
  entry(
    "ne-te-05",
    "test",
    "comms",
    250,
    3105,
    "Trade desk eDiscovery review set",
    "Emails and chats from a trade desk mailbox, full of nicknames and handles.",
  ),
  entry(
    "ne-te-06",
    "test",
    "statement",
    500,
    3106,
    "Import business bank statements, 2024-2026",
    "Two years of statements; most counterparties appear only in a few sections.",
  ),
  entry(
    "ne-te-07",
    "test",
    "judgment",
    200,
    3107,
    "Court judgment on nominee directors",
    "A judgment on nominee directors who signed for an owner who stayed out of sight.",
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
 * as an email address count only when the Rulebook includes handles, and
 * only the entity types it extracts count (all of them when not given).
 */
export function answerKeyFor(
  answerKey: ExpectedName[],
  rulebook: Pick<Rulebook, "includeHandles"> &
    Partial<Pick<Rulebook, "entityTypes">>,
): ExpectedName[] {
  const types = rulebook.entityTypes;
  return answerKey.filter(
    (name) =>
      (rulebook.includeHandles || !name.handleOnly) &&
      (!types || types.includes(name.type)),
  );
}

export function corpusCards(): CorpusCard[] {
  return CORPUS.map((e) => ({
    id: e.id,
    title: e.title,
    genre: e.genre,
    pages: e.pages,
    split: e.split,
    description: e.description,
    featured: e.featured,
    expectedNames: planParties(input(e)).parties.length,
  }));
}
