import type { Owner } from "@/features/access/domain/owner";
import {
  type AuditAction,
  MODEL_ACTOR,
  SYSTEM_ACTOR,
} from "../../domain/audit";
import { evaluate } from "../../domain/evaluate";
import { type FieldCheck, fieldChecks } from "../../domain/field-checks";
import { countOutcomes } from "../../domain/review";
import { type AppliedRule, rulebookFromApplied } from "../../domain/rules";
import type {
  DocumentKind,
  ExtractedDocument,
  FieldReading,
  Span,
} from "../../domain/types";
import { correctSpans, verifyReading } from "../../domain/verify";
import type { ReadUsage } from "../../metrics";
import {
  findPack,
  type Pack,
  type PackDocument,
  storagePath,
} from "../../packs";
import { type FindingView, findingViews } from "../../view";
import type { ParsedDocument } from "../parsers";
import type {
  AuditInput,
  AuditLog,
  DocumentParser,
  DocumentReader,
  PackStore,
  RawExtraction,
  RunRepository,
  SavedDocument,
} from "../ports";

/** What every step of one run knows; plain data, so workflow steps can take it. */
export type PrescreenRun = {
  runId: string;
  packSlug: string;
  /** The Rules the run applies; null for a run started before Rules were edited. */
  rules: AppliedRule[] | null;
  /** Whose Audit trail the run writes to; null for a run started before it. */
  owner: Owner | null;
};

/** What reading a Document cost and returned, kept with the run (ADR 0007). */
export type ReadRecord = {
  usage: ReadUsage;
  readMs: number;
  raw: RawExtraction;
};

export type ReadResult = {
  extracted: ExtractedDocument;
  usage: ReadUsage;
  raw: RawExtraction;
  /** The Span corrections that changed a Span's text. */
  corrections: { ref: string; from: string; to: string }[];
};

export type ProcessedDocument = {
  parsed: Omit<ParsedDocument, "spans"> & { parseMs: number };
  extracted: ExtractedDocument;
  read: ReadRecord;
};

/**
 * The work inside each step of the Pre-screen workflow (ADR 0003). The
 * workflow file owns only the order, the retries and the stream; what a step
 * does (download, parse, read, verify, evaluate, save, audit) is here, so the
 * stubbed e2e suite and the live demo run the same code but for the reader.
 */
export interface PrescreenService {
  markStatus(runId: string, status: "parsing" | "evaluating"): Promise<void>;
  /** The Document's text and where each piece sits on the page (ADR 0004). */
  parse(packSlug: string, kind: DocumentKind): Promise<ParsedDocument>;
  /**
   * The model corrects OCR'd Span text and reads each field as Span
   * references; code then verifies every reading against the corrected Spans.
   */
  read(
    run: PrescreenRun,
    kind: DocumentKind,
    spans: Span[],
    ocr: boolean,
    onReading?: (reading: FieldReading) => Promise<void>,
  ): Promise<ReadResult>;
  /** The Document's Field checks, and its `document.read` Audit event. */
  finishRead(
    run: PrescreenRun,
    extracted: ExtractedDocument,
    usage: ReadUsage,
    readMs: number,
  ): Promise<FieldCheck[]>;
  /** Evaluates the Rulebook, saves the whole chain and marks the run completed. */
  save(
    run: PrescreenRun,
    processed: ProcessedDocument[],
  ): Promise<FindingView[]>;
  fail(run: PrescreenRun, message: string): Promise<void>;
}

function packAndDocument(packSlug: string, kind: DocumentKind) {
  const pack = findPack(packSlug);
  const document = pack?.documents.find((item) => item.kind === kind);
  if (!pack || !document) throw new Error(`No ${kind} in pack ${packSlug}`);
  return { pack, document };
}

export function createPrescreenService(ports: {
  runs: RunRepository;
  audit: AuditLog;
  packs: PackStore;
  parser: DocumentParser;
  reader: DocumentReader;
  logLost: (action: AuditAction, error: unknown) => void;
}): PrescreenService {
  const { runs, packs, parser, reader } = ports;

  /** An event about work that stands either way: a failure is logged, not thrown. */
  async function auditBestEffort(event: AuditInput) {
    try {
      await ports.audit.append(event);
    } catch (error) {
      ports.logLost(event.action, error);
    }
  }

  function pageImages(pack: Pack, document: PackDocument) {
    return Promise.all(
      document.pages.map(async (file) => ({
        data: await packs.download(storagePath(pack.slug, file)),
        mediaType: file.endsWith(".png") ? "image/png" : "image/jpeg",
      })),
    );
  }

  return {
    markStatus: (runId, status) => runs.setStatus(runId, status),

    async parse(packSlug, kind) {
      const { pack, document } = packAndDocument(packSlug, kind);
      const [file, pages] = await Promise.all([
        packs.download(storagePath(pack.slug, document.file)),
        pageImages(pack, document),
      ]);
      return parser.parse({
        file,
        sourceFormat: document.sourceFormat,
        pageImages: pages.map((page) => page.data),
      });
    },

    async read(run, kind, ocrSpans, ocr, onReading) {
      const { pack, document } = packAndDocument(run.packSlug, kind);
      const extraction = await reader.read({
        packSlug: pack.slug,
        kind,
        spans: ocrSpans,
        ocr,
        pageImages: await pageImages(pack, document),
        onReading,
      });
      const { spans, applied } = correctSpans(
        ocrSpans,
        ocr ? extraction.corrections : [],
      );
      return {
        extracted: {
          kind,
          spans,
          fields: extraction.readings.map((reading) =>
            verifyReading(reading, spans),
          ),
          judgments: extraction.judgments,
        },
        usage: extraction.usage,
        raw: extraction.raw,
        corrections: applied,
      };
    },

    async finishRead(run, extracted, usage, readMs) {
      const pack = findPack(run.packSlug);
      if (!pack) throw new Error(`Unknown pack ${run.packSlug}`);
      const checks = fieldChecks(extracted, {
        rulebook: rulebookFromApplied(run.rules),
        prescreenDate: pack.prescreenDate,
        declaration: pack.clientDeclaration,
      });
      if (run.owner) {
        const verified = extracted.fields.filter(
          (field) => field.verified,
        ).length;
        await auditBestEffort({
          owner: run.owner,
          runId: run.runId,
          actor: { ...MODEL_ACTOR, label: usage.model ?? MODEL_ACTOR.label },
          action: "document.read",
          summary: `Read the ${extracted.kind.replaceAll("_", " ")}: ${extracted.fields.length} fields, ${verified} found on the page`,
          details: {
            kind: extracted.kind,
            fields: extracted.fields.length,
            verified,
            readMs,
            provider: usage.provider,
          },
          usage,
        });
      }
      return checks;
    },

    async save(run, processed) {
      const { runId, packSlug } = run;
      const pack = findPack(packSlug);
      if (!pack) throw new Error(`Unknown pack ${packSlug}`);
      const rulebook = rulebookFromApplied(run.rules);

      // One Document at a time: each is its own transaction, and a retried
      // step meets no half-saved Document.
      const saved = new Map<DocumentKind, SavedDocument>();
      for (const { parsed, extracted, read } of processed) {
        const document = pack.documents.find(
          (item) => item.kind === extracted.kind,
        );
        if (!document) continue;
        saved.set(
          extracted.kind,
          await runs.saveDocument(
            runId,
            {
              storagePath: storagePath(pack.slug, document.file),
              mediaType: document.mediaType,
              sourceFormat: document.sourceFormat,
              parser: parsed.parser,
              pageCount: parsed.pageCount,
              parseMs: parsed.parseMs,
              ...read,
            },
            extracted,
          ),
        );
      }

      const findings = evaluate({
        rulebook,
        prescreenDate: pack.prescreenDate,
        declaration: pack.clientDeclaration,
        documents: processed.map(({ extracted }) => extracted),
      });
      await runs.saveFindings(runId, findings, saved);
      if (run.owner) {
        const counts = countOutcomes(findings);
        await auditBestEffort({
          owner: run.owner,
          runId,
          actor: SYSTEM_ACTOR,
          action: "run.finished",
          summary: `${pack.title}: ${counts.pass} pass, ${counts.fail} fail, ${counts.needs_review} needs review`,
          details: { pack: pack.slug, counts },
        });
      }
      return findingViews(rulebook, findings);
    },

    async fail(run, message) {
      await runs.fail(run.runId, message);
      if (run.owner) {
        await auditBestEffort({
          owner: run.owner,
          runId: run.runId,
          actor: SYSTEM_ACTOR,
          action: "run.failed",
          summary: `Failed: ${message.slice(0, 200)}`,
          details: { pack: run.packSlug },
        });
      }
    },
  };
}
