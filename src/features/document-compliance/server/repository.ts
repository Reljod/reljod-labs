import "server-only";
import { fieldChecks } from "../domain/field-checks";
import type { Rulebook } from "../domain/rulebook";
import { individualOnboarding } from "../domain/rulebook";
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
import type { FindingView, RunView, SessionRunView } from "../view";
import type { Database } from "./database.types";
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
  sessionId: string;
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
        visitor_hash: input.visitorHash,
        session_id: input.sessionId,
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

export async function workflowRunIdOf(runId: string) {
  const [run] = rows<{ workflow_run_id: string | null }[]>(
    await supabase()
      .from("prescreen_runs")
      .select("workflow_run_id")
      .eq("id", runId)
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
    raw: unknown;
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
        raw_output: (meta.raw ??
          null) as Tables["documents"]["Row"]["raw_output"],
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

export async function latestCompletedRunId(packSlug: string) {
  const latest = rows<{ id: string }[]>(
    await supabase()
      .from("prescreen_runs")
      .select("id")
      .eq("pack_slug", packSlug)
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

async function selectIn<Name extends keyof Tables>(
  table: Name,
  column: string,
  values: (string | number)[],
): Promise<Tables[Name]["Row"][]> {
  if (values.length === 0) return [];
  return rows<Tables[Name]["Row"][]>(
    await supabase().from(table).select("*").in(column, values),
  );
}

/** Loads a run and everything it produced, shaped for the Reviewer view. */
export async function loadRun(runId: string): Promise<RunView | null> {
  const [run] = await selectIn("prescreen_runs", "id", [runId]);
  if (!run) return null;
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

  const runFindings = individualOnboarding.requirements.flatMap(
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
  const checkContext = {
    rulebook: individualOnboarding,
    prescreenDate: pack?.prescreenDate ?? "",
    declaration: run.client_declaration as ClientDeclaration,
  };

  return {
    id: run.id,
    packSlug: run.pack_slug,
    status: run.status,
    error: run.error,
    model: run.model,
    createdAt: run.created_at,
    completedAt: run.completed_at,
    prescreenDate: pack?.prescreenDate ?? "",
    documents: documents.map((document) => {
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
          {
            kind: document.kind,
            spans: [],
            fields: documentFields.map((field) => ({
              ...field,
              confidence: field.confidence ?? 0,
            })),
            judgments,
          },
          checkContext,
        ),
      };
    }),
    findings: runFindings,
  };
}

type DocumentRow = Tables["documents"]["Row"];

/** Null for a Document saved before run metrics were kept (ADR 0007). */
function documentMetrics(row: DocumentRow): DocumentMetrics | null {
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

/** A Session's runs, newest first, each with its cost and Finding counts. */
export async function listSessionRuns(
  sessionId: string,
  limit = 20,
): Promise<SessionRunView[]> {
  const runs = rows<Tables["prescreen_runs"]["Row"][]>(
    await supabase()
      .from("prescreen_runs")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  const runIds = runs.map((run) => run.id);
  const [documents, findings] = await Promise.all([
    selectIn("documents", "run_id", runIds),
    selectIn("findings", "run_id", runIds),
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
