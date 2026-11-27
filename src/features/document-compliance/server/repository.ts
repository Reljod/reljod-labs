import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { jsonb } from "@/server/postgres";
import { fieldChecks } from "../domain/field-checks";
import type { ReviewView } from "../domain/review";
import type { RequirementId, Rulebook } from "../domain/rulebook";
import { parseAppliedRules, rulebookFromApplied } from "../domain/rules";
import type {
  ClientDeclaration,
  DocumentJudgments,
  DocumentKind,
  ExtractedDocument,
  FieldName,
  Finding,
} from "../domain/types";
import {
  asNumber,
  type DocumentMetrics,
  type ReadUsage,
  runTotals,
} from "../metrics";
import { findPack, storagePath } from "../packs";
import type {
  DocumentView,
  EvaluationView,
  FindingView,
  RunView,
  SessionRunView,
} from "../view";
import type { Database } from "./database.types";
import { sql } from "./db";
import type { RawExtraction } from "./extract";
import { packPageUrls } from "./supabase";

type Tables = Database["document_compliance"]["Tables"];
type Row<Name extends keyof Tables> = Tables[Name]["Row"];
type RunStatus = Row<"prescreen_runs">["status"];

/** Rows per multi-row insert, well under Postgres's 65,535 parameters a statement. */
const INSERT_BATCH = 1000;

function batches<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += INSERT_BATCH) {
    out.push(items.slice(start, start + INSERT_BATCH));
  }
  return out;
}

/** Which rate limit refused a run: the visitor's hourly one, or the demo's daily one. */
export type RunRefusal = "visitor" | "day";

/**
 * Creates a queued run, counted against the rate limits and inserted in one
 * transaction under an advisory lock (`create_prescreen_run`), so two
 * requests at once cannot both take the last place. `limits` null skips the
 * check (the e2e suite).
 */
export async function createRun(input: {
  packSlug: string;
  rulebook: Rulebook;
  declaration: ClientDeclaration;
  visitorHash: string;
  owner: Owner;
  model: string;
  limits: { perVisitorPerHour: number; perDay: number } | null;
}): Promise<{ runId: string } | { refusal: RunRefusal }> {
  const db = sql();
  const [row] = await db<{ run_id: string | null; refusal: string | null }[]>`
    select run_id, refusal from document_compliance.create_prescreen_run(
      p_owner => ${input.owner}::text,
      p_visitor_hash => ${input.visitorHash}::text,
      p_pack_slug => ${input.packSlug}::text,
      p_rulebook_id => ${input.rulebook.id}::text,
      p_rulebook_version => ${input.rulebook.version}::text,
      p_client_declaration => ${jsonb(db, input.declaration)},
      p_rules_applied => ${jsonb(db, input.rulebook.applied)},
      p_model => ${input.model}::text,
      p_per_visitor_per_hour => ${input.limits?.perVisitorPerHour ?? null}::integer,
      p_per_day => ${input.limits?.perDay ?? null}::integer
    )`;
  if (row?.run_id) return { runId: row.run_id };
  return { refusal: row?.refusal === "visitor" ? "visitor" : "day" };
}

export async function setRunStatus(runId: string, status: RunStatus) {
  await sql()`
    update document_compliance.prescreen_runs set status = ${status}
    where id = ${runId}`;
}

export async function setWorkflowRunId(runId: string, workflowRunId: string) {
  await sql()`
    update document_compliance.prescreen_runs
    set workflow_run_id = ${workflowRunId}
    where id = ${runId}`;
}

/** The workflow run behind an Owner's Pre-screen run; null for anyone else's. */
export async function workflowRunIdOf(runId: string, owner: Owner) {
  const [run] = await sql()<{ workflow_run_id: string | null }[]>`
    select workflow_run_id from document_compliance.prescreen_runs
    where id = ${runId} and owner = ${owner}
    limit 1`;
  return run?.workflow_run_id ?? null;
}

export async function failRun(runId: string, message: string) {
  await sql()`
    update document_compliance.prescreen_runs
    set status = 'failed', error = ${message.slice(0, 1000)}
    where id = ${runId}`;
}

/** Ids of what was saved, so Findings can point at them. */
export type SavedDocument = {
  documentId: number;
  spanIds: Map<string, number>;
  fieldIds: Map<FieldName, number>;
};

export async function saveDocument(
  runId: string,
  meta: {
    storagePath: string;
    mediaType: string;
    sourceFormat: Tables["documents"]["Row"]["source_format"];
    parser: Tables["documents"]["Row"]["parser"];
    pageCount: number;
    parseMs: number;
    readMs: number;
    usage: ReadUsage;
    raw: RawExtraction;
  },
  document: ExtractedDocument,
): Promise<SavedDocument> {
  // One transaction: a step that fails part-way and is retried leaves no
  // half-saved Document behind to collide with on `(document_id, ref)`.
  return sql().begin(async (tx) => {
    const [row] = await tx<{ id: number }[]>`
      insert into document_compliance.documents (
        run_id, kind, storage_path, media_type, source_format, parser,
        page_count, model, provider, input_tokens, output_tokens,
        reasoning_tokens, cached_input_tokens, cost_usd, parse_ms, read_ms,
        raw_output
      ) values (
        ${runId}, ${document.kind}, ${meta.storagePath}, ${meta.mediaType},
        ${meta.sourceFormat}, ${meta.parser}, ${meta.pageCount},
        ${meta.usage.model}, ${meta.usage.provider}, ${meta.usage.inputTokens},
        ${meta.usage.outputTokens}, ${meta.usage.reasoningTokens},
        ${meta.usage.cachedInputTokens}, ${meta.usage.costUsd},
        ${Math.round(meta.parseMs)}, ${Math.round(meta.readMs)},
        ${meta.raw === null || meta.raw === undefined ? null : jsonb(tx, meta.raw)}
      )
      returning id`;
    if (!row) throw new Error("Query returned no data");
    const documentId = row.id;

    const spanIds = new Map<string, number>();
    for (const batch of batches(document.spans)) {
      const values = batch.map((span) => ({
        document_id: documentId,
        ref: span.ref,
        page: span.page,
        text: span.text,
        granularity: span.granularity,
        x0: span.box.x0,
        y0: span.box.y0,
        x1: span.box.x1,
        y1: span.box.y1,
        confidence: span.confidence,
      }));
      const inserted = await tx<{ id: number; ref: string }[]>`
        insert into document_compliance.spans ${tx(values)}
        returning id, ref`;
      for (const span of inserted) spanIds.set(span.ref, span.id);
    }

    const fieldIds = new Map<FieldName, number>();
    for (const batch of batches(document.fields)) {
      const values = batch.map((field) => ({
        document_id: documentId,
        name: field.name,
        value: field.value,
        confidence: field.confidence,
        verified: field.verified,
      }));
      const inserted = await tx<{ id: number; name: string }[]>`
        insert into document_compliance.extracted_fields ${tx(values)}
        returning id, name`;
      for (const field of inserted)
        fieldIds.set(field.name as FieldName, field.id);
    }

    const links = document.fields.flatMap((field) =>
      field.spanRefs.flatMap((ref) => {
        const spanId = spanIds.get(ref);
        const fieldId = fieldIds.get(field.name);
        return spanId && fieldId
          ? [{ extracted_field_id: fieldId, span_id: spanId }]
          : [];
      }),
    );
    for (const batch of batches(links)) {
      await tx`insert into document_compliance.extracted_field_spans ${tx(batch)}`;
    }

    return { documentId, spanIds, fieldIds };
  });
}

/** Saves the Findings with their Evidence and marks the run completed. */
export async function saveFindings(
  runId: string,
  findings: Finding[],
  saved: Map<DocumentKind, SavedDocument>,
) {
  // One transaction: the Findings, their Evidence and the completed status
  // land together, so a retried step never meets its own half-saved Findings.
  await sql().begin(async (tx) => {
    const findingIds = new Map<string, number>();
    for (const batch of batches(findings)) {
      const values = batch.map((finding) => ({
        run_id: runId,
        requirement_id: finding.requirementId,
        outcome: finding.outcome,
        reason: finding.reason,
      }));
      const inserted = await tx<{ id: number; requirement_id: string }[]>`
        insert into document_compliance.findings ${tx(values)}
        returning id, requirement_id`;
      for (const row of inserted) findingIds.set(row.requirement_id, row.id);
    }
    const evidenceRows = evidenceRowsOf(findings, findingIds, saved);
    for (const batch of batches(evidenceRows)) {
      await tx`insert into document_compliance.finding_evidence ${tx(batch)}`;
    }
    await tx`
      update document_compliance.prescreen_runs
      set status = 'completed', completed_at = ${new Date().toISOString()}
      where id = ${runId}`;
  });
}

type EvidenceInsert = Omit<Row<"finding_evidence">, "id">;

/** One Evidence row per cited span, or one without a span when it cites none. */
function evidenceRowsOf(
  findings: Finding[],
  findingIds: Map<string, number>,
  saved: Map<DocumentKind, SavedDocument>,
): EvidenceInsert[] {
  return findings.flatMap((finding): EvidenceInsert[] => {
    const findingId = findingIds.get(finding.requirementId);
    if (!findingId) return [];
    return finding.evidence.flatMap((evidence): EvidenceInsert[] => {
      const document = saved.get(evidence.documentKind);
      if (!document) return [];
      const base = {
        finding_id: findingId,
        document_id: document.documentId,
        extracted_field_id: evidence.fieldName
          ? (document.fieldIds.get(evidence.fieldName) ?? null)
          : null,
      };
      const spanIds = evidence.spanRefs.flatMap((ref) => {
        const id = document.spanIds.get(ref);
        return id === undefined ? [] : [id];
      });
      return spanIds.length === 0
        ? [{ ...base, span_id: null }]
        : spanIds.map((spanId) => ({ ...base, span_id: spanId }));
    });
  });
}

/** The Owner's newest finished run of a pack: where a limited visitor lands. */
export async function latestCompletedRunId(packSlug: string, owner: Owner) {
  const [latest] = await sql()<{ id: string }[]>`
    select id from document_compliance.prescreen_runs
    where pack_slug = ${packSlug} and owner = ${owner} and status = 'completed'
    order by completed_at desc
    limit 1`;
  return latest?.id ?? null;
}

}

/** What a Session list needs from each Document: its metrics, never its raw answer. */
const METRIC_COLUMNS = [
  "run_id",
  "model",
  "provider",
  "input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "cached_input_tokens",
  "cost_usd",
  "parse_ms",
  "read_ms",
] as const;

/** Loads a run and everything it produced, shaped for the Reviewer view. */
/** An Owner's run, whole; null when it is missing or someone else's. */
export async function loadRun(
  runId: string,
  owner: Owner,
): Promise<RunView | null> {
  const db = sql();
  const [run] = await db<Row<"prescreen_runs">[]>`
    select * from document_compliance.prescreen_runs
    where id = ${runId} and owner = ${owner}`;
  if (!run) return null;
  const pack = findPack(run.pack_slug);

  // Once the run is known to be the Owner's, every read starts at once: each
  // reaches its rows through the run, by join, in the order they were saved.
  const documentsRead = (async () => {
    const [documents, spans, fields, fieldSpans] = await Promise.all([
      db<Row<"documents">[]>`
        select * from document_compliance.documents
        where run_id = ${runId}
        order by id`,
      db<Row<"spans">[]>`
        select s.* from document_compliance.spans s
        join document_compliance.documents d on d.id = s.document_id
        where d.run_id = ${runId}
        order by s.id`,
      db<Row<"extracted_fields">[]>`
        select f.* from document_compliance.extracted_fields f
        join document_compliance.documents d on d.id = f.document_id
        where d.run_id = ${runId}
        order by f.id`,
      db<Row<"extracted_field_spans">[]>`
        select l.* from document_compliance.extracted_field_spans l
        join document_compliance.extracted_fields f on f.id = l.extracted_field_id
        join document_compliance.documents d on d.id = f.document_id
        where d.run_id = ${runId}
        order by l.extracted_field_id, l.span_id`,
    ]);
    return { documents, spans, fields, fieldSpans };
  })();
  const findingsRead = (async () => {
    const [findings, evidence] = await Promise.all([
      db<Row<"findings">[]>`
        select * from document_compliance.findings
        where run_id = ${runId}
        order by id`,
      db<Row<"finding_evidence">[]>`
        select e.* from document_compliance.finding_evidence e
        join document_compliance.findings f on f.id = e.finding_id
        where f.run_id = ${runId}
        order by e.id`,
    ]);
    return { findings, evidence };
  })();
  const [
    { documents, spans, fields, fieldSpans },
    { findings, evidence },
    urls,
    [savedEvaluations, reviews],
  ] = await Promise.all([
    documentsRead,
    findingsRead,
    packPageUrls(
      pack?.documents.flatMap((document) =>
        document.pages.map((page) => storagePath(pack.slug, page)),
      ) ?? [],
    ),
    Promise.all([loadEvaluations(runId), loadReviews(runId)]),
  ]);

  const refBySpanId = new Map(spans.map((span) => [span.id, span.ref]));
  const kindByDocumentId = new Map(
    documents.map((document) => [document.id, document.kind]),
  );
  const fieldNameById = new Map(
    fields.map((field) => [field.id, field.name as FieldName]),
  );

  const rulesApplied = parseAppliedRules(run.rules_applied ?? null);
  const rulebook = rulebookFromApplied(rulesApplied);
  const runFindings = rulebook.requirements.flatMap(
    (requirement): FindingView[] => {
      const finding = findings.find(
        (row) => row.requirement_id === requirement.id,
      );
      if (!finding) return [];
      const grouped = new Map<string, FindingView["evidence"][number]>();
      for (const row of evidence) {
        if (row.finding_id !== finding.id) continue;
        const documentKind = kindByDocumentId.get(row.document_id);
        if (!documentKind) continue;
        const fieldName = row.extracted_field_id
          ? (fieldNameById.get(row.extracted_field_id) ?? null)
          : null;
        const key = `${documentKind}:${fieldName ?? ""}`;
        const entry = grouped.get(key) ?? {
          documentKind,
          fieldName,
          spanRefs: [],
        };
        const ref = row.span_id ? refBySpanId.get(row.span_id) : undefined;
        if (ref) entry.spanRefs.push(ref);
        grouped.set(key, entry);
      }
      return [
        {
          requirementId: requirement.id,
          title: requirement.title,
          outcome: finding.outcome,
          reason: finding.reason,
          evidence: [...grouped.values()],
        },
      ];
    },
  );

  // Judgments are not stored; suspected tampering survives as the spans the
  // no-tampering Finding cites, which is all a Field check needs.
  const tamperingRefs = (kind: DocumentKind) =>
    runFindings
      .find((finding) => finding.requirementId === "no-tampering")
      ?.evidence.filter((item) => item.documentKind === kind && !item.fieldName)
      .flatMap((item) => item.spanRefs) ?? [];
  const prescreenDate = pack?.prescreenDate ?? "";
  const declaration = run.client_declaration as ClientDeclaration;
  const checkContext = { rulebook, prescreenDate, declaration };

  const runDocuments: DocumentView[] = documents.map((document) => {
    const documentFields = fields
      .filter((field) => field.document_id === document.id)
      .map((field) => ({
        name: field.name as FieldName,
        value: field.value,
        verified: field.verified,
        confidence: field.confidence,
        spanRefs: fieldSpans
          .filter((link) => link.extracted_field_id === field.id)
          .map((link) => refBySpanId.get(link.span_id) ?? ""),
      }));
    const tampering = tamperingRefs(document.kind);
    // Runs saved with the model's raw answer keep its judgments; older ones
    // rebuild suspected tampering from the no-tampering Finding.
    const judgments = storedJudgments(document.raw_output) ?? {
      legible: true,
      tamperingSuspected: tampering.length > 0,
      tamperingSpanRefs: tampering,
      signaturePresent: null,
      notes: "",
    };
    return {
      kind: document.kind,
      parser: document.parser,
      pageCount: document.page_count,
      pages: (
        pack?.documents.find((candidate) => candidate.kind === document.kind)
          ?.pages ?? []
      ).map((file, index) => ({
        page: index + 1,
        imageUrl: urls.get(storagePath(run.pack_slug, file)) ?? "",
      })),
      spans: spans
        .filter((span) => span.document_id === document.id)
        .map((span) => ({
          ref: span.ref,
          page: span.page,
          text: span.text,
          box: { x0: span.x0, y0: span.y0, x1: span.x1, y1: span.y1 },
          confidence: span.confidence,
        })),
      fields: documentFields,
      judgments,
      metrics: documentMetrics(document),
      raw: document.raw_output ?? null,
      checks: fieldChecks(
        asExtracted({ kind: document.kind, fields: documentFields, judgments }),
        checkContext,
      ),
    };
  });

  const evaluations: EvaluationView[] = [
    {
      number: 1,
      createdAt: run.completed_at ?? run.created_at,
      createdBy: null,
      rules: rulebook.applied,
      findings: runFindings,
      checks: runDocuments.flatMap((document) => document.checks),
    },
    ...savedEvaluations.map((evaluation): EvaluationView => {
      const evaluationRulebook = rulebookFromApplied(evaluation.rules);
      return {
        ...evaluation,
        rules: evaluationRulebook.applied,
        checks: runDocuments.flatMap((document) =>
          fieldChecks(asExtracted(document), {
            rulebook: evaluationRulebook,
            prescreenDate,
            declaration,
          }),
        ),
      };
    }),
  ];

  return {
    id: run.id,
    packSlug: run.pack_slug,
    status: run.status,
    error: run.error,
    model: run.model,
    createdAt: run.created_at,
    completedAt: run.completed_at,
    prescreenDate,
    documents: runDocuments,
    findings: runFindings,
    evaluations,
    reviews,
  };
}

/** A stored Document as evaluation reads it: its fields and the model's judgments. */
export function asExtracted(
  document: Pick<DocumentView, "kind" | "fields" | "judgments">,
): ExtractedDocument {
  return {
    kind: document.kind,
    spans: [],
    fields: document.fields.map((field) => ({
      name: field.name,
      value: field.value,
      spanRefs: field.spanRefs,
      verified: field.verified,
      confidence: field.confidence ?? 0,
    })),
    judgments: document.judgments,
  };
}

/**
 * A table the Rules and Audit trail migration adds, not there yet. Only
 * reading an old run tolerates it; starting a run needs the migration (ADR 0019).
 */
function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "42P01"
  );
}

/** The rows a read returns, or none when its table is not there yet. */
async function unlessMissingTable<T>(read: Promise<T[]>): Promise<T[]> {
  try {
    return await read;
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

/** A run's re-evaluations, oldest first; none before the migration is applied. */
async function loadEvaluations(runId: string) {
  type Row = {
    number: number;
    rules_applied: unknown;
    findings: unknown;
    created_by: string;
    created_at: string;
  };
  const rows = await unlessMissingTable(
    sql()<Row[]>`
      select number, rules_applied, findings, created_by, created_at
      from document_compliance.evaluations
      where run_id = ${runId}
      order by number asc`,
  );
  return rows.map((row) => ({
    number: row.number,
    createdAt: row.created_at,
    createdBy: row.created_by,
    rules: parseAppliedRules(row.rules_applied),
    findings: Array.isArray(row.findings)
      ? (row.findings as FindingView[])
      : [],
  }));
}

/** A run's Reviewer decisions, oldest first. */
async function loadReviews(runId: string): Promise<ReviewView[]> {
  type Row = {
    evaluation: number;
    requirement_id: string;
    finding_outcome: ReviewView["findingOutcome"];
    outcome: ReviewView["outcome"];
    note: string;
    reviewer: string;
    created_at: string;
  };
  const rows = await unlessMissingTable(
    sql()<Row[]>`
      select evaluation, requirement_id, finding_outcome, outcome, note,
        reviewer, created_at
      from document_compliance.finding_reviews
      where run_id = ${runId}
      order by id asc`,
  );
  return rows.map((row) => ({
    requirementId: row.requirement_id as RequirementId,
    evaluation: row.evaluation,
    findingOutcome: row.finding_outcome,
    outcome: row.outcome,
    note: row.note,
    reviewer: row.reviewer,
    at: row.created_at,
  }));
}

type MetricRow = Pick<
  Tables["documents"]["Row"],
  (typeof METRIC_COLUMNS)[number]
>;

/** Null for a Document saved before run metrics were kept (ADR 0007). */
function documentMetrics(row: MetricRow): DocumentMetrics | null {
  // `?? null` too: a database without the metrics columns returns none at all.
  if ((row.read_ms ?? null) === null && (row.model ?? null) === null) {
    return null;
  }
  return {
    model: row.model ?? null,
    provider: row.provider ?? null,
    inputTokens: row.input_tokens ?? null,
    outputTokens: row.output_tokens ?? null,
    reasoningTokens: row.reasoning_tokens ?? null,
    cachedInputTokens: row.cached_input_tokens ?? null,
    costUsd: asNumber(row.cost_usd),
    parseMs: row.parse_ms ?? null,
    readMs: row.read_ms ?? null,
  };
}

function storedJudgments(raw: unknown): DocumentJudgments | null {
  if (typeof raw !== "object" || raw === null || !("judgments" in raw)) {
    return null;
  }
  const judgments = (raw as { judgments: unknown }).judgments;
  if (typeof judgments !== "object" || judgments === null) return null;
  const value = judgments as Partial<DocumentJudgments>;
  return {
    legible: value.legible !== false,
    tamperingSuspected: value.tamperingSuspected === true,
    tamperingSpanRefs: Array.isArray(value.tamperingSpanRefs)
      ? value.tamperingSpanRefs.filter((ref) => typeof ref === "string")
      : [],
    signaturePresent:
      typeof value.signaturePresent === "boolean"
        ? value.signaturePresent
        : null,
    notes: typeof value.notes === "string" ? value.notes : "",
  };
}

/** An Owner's runs, newest first, each with its cost and Finding counts. */
export async function listOwnerRuns(
  owner: Owner,
  limit = 20,
): Promise<SessionRunView[]> {
  const db = sql();
  const runs = await db<Row<"prescreen_runs">[]>`
    select * from document_compliance.prescreen_runs
    where owner = ${owner}
    order by created_at desc
    limit ${limit}`;
  const runIds = runs.map((run) => run.id);
  const [documents, findings] =
    runIds.length === 0
      ? [[], []]
      : await Promise.all([
          db<MetricRow[]>`
            select ${db([...METRIC_COLUMNS])} from document_compliance.documents
            where run_id = any(${runIds}::uuid[])
            order by id`,
          db<Pick<Row<"findings">, "run_id" | "outcome">[]>`
            select run_id, outcome from document_compliance.findings
            where run_id = any(${runIds}::uuid[])
            order by id`,
        ]);
  return runs.map((run) => {
    const totals = runTotals(
      documents
        .filter((document) => document.run_id === run.id)
        .map(documentMetrics),
    );
    const outcomes = findings
      .filter((finding) => finding.run_id === run.id)
      .map((finding) => finding.outcome);
    const count = (outcome: string) =>
      outcomes.filter((item) => item === outcome).length;
    return {
      id: run.id,
      packSlug: run.pack_slug,
      status: run.status,
      createdAt: run.created_at,
      completedAt: run.completed_at,
      model: totals.models[0] ?? run.model,
      costUsd: totals.costUsd,
      tokens: totals.inputTokens + totals.outputTokens,
      counts: {
        pass: count("pass"),
        fail: count("fail"),
        needs_review: count("needs_review"),
      },
    };
  });
}
