import "server-only";
import type { Owner } from "@/features/access/domain/owner";
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
import type { RawExtraction } from "./extract";
import { signedUrls, supabase } from "./supabase";

type Tables = Database["document_compliance"]["Tables"];
type RunStatus = Tables["prescreen_runs"]["Row"]["status"];

/** Unwraps a query, typing its data as the caller's row shape (the client is untyped). */
function rows<T>(result: {
  data: unknown;
  error: { message: string } | null;
}): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null || result.data === undefined) {
    throw new Error("Query returned no data");
  }
  return result.data as T;
}

/** Checks a write that returns nothing. */
function ok(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
}

export async function createRun(input: {
  packSlug: string;
  rulebook: Rulebook;
  declaration: ClientDeclaration;
  visitorHash: string;
  owner: Owner;
  model: string;
}) {
  const run = rows<{ id: string }>(
    await supabase()
      .from("prescreen_runs")
      .insert({
        pack_slug: input.packSlug,
        rulebook_id: input.rulebook.id,
        rulebook_version: input.rulebook.version,
        client_declaration: input.declaration,
        rules_applied: input.rulebook.applied,
        visitor_hash: input.visitorHash,
        owner: input.owner,
        model: input.model,
        status: "queued",
      })
      .select("id")
      .single(),
  );
  return run.id;
}

export async function setRunStatus(runId: string, status: RunStatus) {
  ok(
    await supabase().from("prescreen_runs").update({ status }).eq("id", runId),
  );
}

export async function setWorkflowRunId(runId: string, workflowRunId: string) {
  ok(
    await supabase()
      .from("prescreen_runs")
      .update({ workflow_run_id: workflowRunId })
      .eq("id", runId),
  );
}

/** The workflow run behind an Owner's Pre-screen run; null for anyone else's. */
export async function workflowRunIdOf(runId: string, owner: Owner) {
  const [run] = rows<{ workflow_run_id: string | null }[]>(
    await supabase()
      .from("prescreen_runs")
      .select("workflow_run_id")
      .eq("id", runId)
      .eq("owner", owner)
      .limit(1),
  );
  return run?.workflow_run_id ?? null;
}

export async function failRun(runId: string, message: string) {
  ok(
    await supabase()
      .from("prescreen_runs")
      .update({ status: "failed", error: message.slice(0, 1000) })
      .eq("id", runId),
  );
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
  const documentId = rows<{ id: number }>(
    await supabase()
      .from("documents")
      .insert({
        run_id: runId,
        kind: document.kind,
        storage_path: meta.storagePath,
        media_type: meta.mediaType,
        source_format: meta.sourceFormat,
        parser: meta.parser,
        page_count: meta.pageCount,
        model: meta.usage.model,
        provider: meta.usage.provider,
        input_tokens: meta.usage.inputTokens,
        output_tokens: meta.usage.outputTokens,
        reasoning_tokens: meta.usage.reasoningTokens,
        cached_input_tokens: meta.usage.cachedInputTokens,
        cost_usd: meta.usage.costUsd,
        parse_ms: Math.round(meta.parseMs),
        read_ms: Math.round(meta.readMs),
        raw_output: meta.raw,
      })
      .select("id")
      .single(),
  ).id;

  const spanRows =
    document.spans.length === 0
      ? []
      : rows<{ id: number; ref: string }[]>(
          await supabase()
            .from("spans")
            .insert(
              document.spans.map((span) => ({
                document_id: documentId,
                ref: span.ref,
                page: span.page,
                text: span.text,
                granularity: span.granularity,
                ...span.box,
                confidence: span.confidence,
              })),
            )
            .select("id, ref"),
        );
  const spanIds = new Map(spanRows.map((row) => [row.ref, row.id]));

  const fieldRows =
    document.fields.length === 0
      ? []
      : rows<{ id: number; name: string }[]>(
          await supabase()
            .from("extracted_fields")
            .insert(
              document.fields.map((field) => ({
                document_id: documentId,
                name: field.name,
                value: field.value,
                confidence: field.confidence,
                verified: field.verified,
              })),
            )
            .select("id, name"),
        );
  const fieldIds = new Map(
    fieldRows.map((row) => [row.name as FieldName, row.id]),
  );

  const links = document.fields.flatMap((field) =>
    field.spanRefs.flatMap((ref) => {
      const spanId = spanIds.get(ref);
      const fieldId = fieldIds.get(field.name);
      return spanId && fieldId
        ? [{ extracted_field_id: fieldId, span_id: spanId }]
        : [];
    }),
  );
  if (links.length > 0) {
    ok(await supabase().from("extracted_field_spans").insert(links));
  }

  return { documentId, spanIds, fieldIds };
}

/** Saves the Findings with their Evidence and marks the run completed. */
export async function saveFindings(
  runId: string,
  findings: Finding[],
  saved: Map<DocumentKind, SavedDocument>,
) {
  const findingRows = rows<{ id: number; requirement_id: string }[]>(
    await supabase()
      .from("findings")
      .insert(
        findings.map((finding) => ({
          run_id: runId,
          requirement_id: finding.requirementId,
          outcome: finding.outcome,
          reason: finding.reason,
        })),
      )
      .select("id, requirement_id"),
  );
  const findingIds = new Map(
    findingRows.map((row) => [row.requirement_id, row.id]),
  );

  type EvidenceInsert = Tables["finding_evidence"]["Insert"];
  const evidenceRows = findings.flatMap((finding): EvidenceInsert[] => {
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
  if (evidenceRows.length > 0) {
    ok(await supabase().from("finding_evidence").insert(evidenceRows));
  }

  ok(
    await supabase()
      .from("prescreen_runs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", runId),
  );
}

export async function countRuns(filter: { visitorHash?: string; since: Date }) {
  let query = supabase()
    .from("prescreen_runs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", filter.since.toISOString());
  if (filter.visitorHash) query = query.eq("visitor_hash", filter.visitorHash);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** The Owner's newest finished run of a pack: where a limited visitor lands. */
export async function latestCompletedRunId(packSlug: string, owner: Owner) {
  const latest = rows<{ id: string }[]>(
    await supabase()
      .from("prescreen_runs")
      .select("id")
      .eq("pack_slug", packSlug)
      .eq("owner", owner)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1),
  );
  return latest[0]?.id ?? null;
}

export async function deleteRunsByVisitor(visitorHash: string) {
  ok(
    await supabase()
      .from("prescreen_runs")
      .delete()
      .eq("visitor_hash", visitorHash),
  );
}

async function selectIn<
  Name extends keyof Tables,
  Column extends keyof Tables[Name]["Row"] &
    string = keyof Tables[Name]["Row"] & string,
>(
  table: Name,
  column: string,
  values: (string | number)[],
  columns?: readonly Column[],
): Promise<Pick<Tables[Name]["Row"], Column>[]> {
  if (values.length === 0) return [];
  return rows<Pick<Tables[Name]["Row"], Column>[]>(
    await supabase()
      .from(table)
      .select(columns ? columns.join(", ") : "*")
      .in(column, values),
  );
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
  const [run] = await selectIn("prescreen_runs", "id", [runId]);
  if (!run || run.owner !== owner) return null;
  const pack = findPack(run.pack_slug);

  const documents = await selectIn("documents", "run_id", [runId]);
  const documentIds = documents.map((document) => document.id);
  const [spans, fields, findings] = await Promise.all([
    selectIn("spans", "document_id", documentIds),
    selectIn("extracted_fields", "document_id", documentIds),
    selectIn("findings", "run_id", [runId]),
  ]);
  const [fieldSpans, evidence] = await Promise.all([
    selectIn(
      "extracted_field_spans",
      "extracted_field_id",
      fields.map((field) => field.id),
    ),
    selectIn(
      "finding_evidence",
      "finding_id",
      findings.map((finding) => finding.id),
    ),
  ]);

  const refBySpanId = new Map(spans.map((span) => [span.id, span.ref]));
  const kindByDocumentId = new Map(
    documents.map((document) => [document.id, document.kind]),
  );
  const fieldNameById = new Map(
    fields.map((field) => [field.id, field.name as FieldName]),
  );

  const urls = await signedUrls(
    pack?.documents.flatMap((document) =>
      document.pages.map((page) => storagePath(pack.slug, page)),
    ) ?? [],
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

  const [savedEvaluations, reviews] = await Promise.all([
    loadEvaluations(runId),
    loadReviews(runId),
  ]);
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
const missingTable = (error: { code?: string; message: string }) =>
  error.code === "42P01" ||
  error.code === "PGRST205" ||
  error.message.includes("schema cache");

/** A run's re-evaluations, oldest first; none before the migration is applied. */
async function loadEvaluations(runId: string) {
  const { data, error } = await supabase()
    .from("evaluations")
    .select("number, rules_applied, findings, created_by, created_at")
    .eq("run_id", runId)
    .order("number", { ascending: true });
  if (error) {
    if (missingTable(error)) return [];
    throw new Error(error.message);
  }
  type Row = {
    number: number;
    rules_applied: unknown;
    findings: unknown;
    created_by: string;
    created_at: string;
  };
  return ((data ?? []) as Row[]).map((row) => ({
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
  const { data, error } = await supabase()
    .from("finding_reviews")
    .select(
      "evaluation, requirement_id, finding_outcome, outcome, note, reviewer, created_at",
    )
    .eq("run_id", runId)
    .order("id", { ascending: true });
  if (error) {
    if (missingTable(error)) return [];
    throw new Error(error.message);
  }
  type Row = {
    evaluation: number;
    requirement_id: string;
    finding_outcome: ReviewView["findingOutcome"];
    outcome: ReviewView["outcome"];
    note: string;
    reviewer: string;
    created_at: string;
  };
  return ((data ?? []) as Row[]).map((row) => ({
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
  const runs = rows<Tables["prescreen_runs"]["Row"][]>(
    await supabase()
      .from("prescreen_runs")
      .select("*")
      .eq("owner", owner)
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  const runIds = runs.map((run) => run.id);
  const [documents, findings] = await Promise.all([
    selectIn("documents", "run_id", runIds, METRIC_COLUMNS),
    selectIn("findings", "run_id", runIds, ["run_id", "outcome"] as const),
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
