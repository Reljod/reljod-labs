import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { db, jsonb } from "@/server/postgres";
import { fieldChecks } from "../domain/field-checks";
import type { ReviewView } from "../domain/review";
import type { RequirementId } from "../domain/rulebook";
import { parseAppliedRules, rulebookFromApplied } from "../domain/rules";
import type {
  ClientDeclaration,
  DocumentJudgments,
  DocumentKind,
  FieldName,
  Finding,
} from "../domain/types";
import { asNumber, type DocumentMetrics, runTotals } from "../metrics";
import { findPack, storagePath } from "../packs";
import {
  asExtracted,
  type DocumentView,
  type EvaluationView,
  type FindingView,
  type RunView,
  type SessionRunView,
} from "../view";
import type { Database } from "./database.types";
import type { RunRepository, SavedDocument } from "./ports";
import { packPageUrls } from "./supabase";

type Tables = Database["document_compliance"]["Tables"];
type Row<Name extends keyof Tables> = Tables[Name]["Row"];

/** Rows per multi-row insert, well under Postgres's 65,535 parameters a statement. */
const INSERT_BATCH = 1000;

function batches<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += INSERT_BATCH) {
    out.push(items.slice(start, start + INSERT_BATCH));
  }
  return out;
}

/** What the database functions raise when they refuse, by the word in their message. */
const raised = (error: unknown, word: string) =>
  error instanceof Error && error.message.includes(word);

/** A Document's metrics columns, as the Session list and the run view read them. */
type MetricRow = Pick<
  Row<"documents">,
  | "model"
  | "provider"
  | "input_tokens"
  | "output_tokens"
  | "reasoning_tokens"
  | "cached_input_tokens"
  | "cost_usd"
  | "parse_ms"
  | "read_ms"
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

type RunWithHistory = Row<"prescreen_runs"> & {
  evaluations: {
    number: number;
    rules_applied: unknown;
    findings: unknown;
    created_by: string;
    created_at: string;
  }[];
  reviews: {
    evaluation: number;
    requirement_id: string;
    finding_outcome: ReviewView["findingOutcome"];
    outcome: ReviewView["outcome"];
    note: string;
    reviewer: string;
    created_at: string;
  }[];
};

type FieldWithRefs = Row<"extracted_fields"> & { span_refs: string[] };

type FindingWithEvidence = Row<"findings"> & {
  evidence: {
    document_id: number;
    extracted_field_id: number | null;
    span_id: number | null;
  }[];
};

/**
 * An Owner's run, whole; null when it is missing or someone else's. Every
 * query is scoped to the Owner through the run, so they all start at once:
 * one round of the pool, not a run lookup and then its children.
 */
async function loadRun(runId: string, owner: Owner): Promise<RunView | null> {
  const sql = db();
  const [[run], documents, spans, fields, findings] = await Promise.all([
    sql<RunWithHistory[]>`
      select r.*,
        coalesce((
          select json_agg(json_build_object(
            'number', e.number, 'rules_applied', e.rules_applied,
            'findings', e.findings, 'created_by', e.created_by,
            'created_at', e.created_at) order by e.number)
          from document_compliance.evaluations e where e.run_id = r.id
        ), '[]'::json) as evaluations,
        coalesce((
          select json_agg(json_build_object(
            'evaluation', v.evaluation, 'requirement_id', v.requirement_id,
            'finding_outcome', v.finding_outcome, 'outcome', v.outcome,
            'note', v.note, 'reviewer', v.reviewer,
            'created_at', v.created_at) order by v.id)
          from document_compliance.finding_reviews v where v.run_id = r.id
        ), '[]'::json) as reviews
      from document_compliance.prescreen_runs r
      where r.id = ${runId} and r.owner = ${owner}`,
    sql<Row<"documents">[]>`
      select d.* from document_compliance.documents d
      join document_compliance.prescreen_runs r on r.id = d.run_id
      where d.run_id = ${runId} and r.owner = ${owner}
      order by d.id`,
    sql<Row<"spans">[]>`
      select s.* from document_compliance.spans s
      join document_compliance.documents d on d.id = s.document_id
      join document_compliance.prescreen_runs r on r.id = d.run_id
      where d.run_id = ${runId} and r.owner = ${owner}
      order by s.id`,
    sql<FieldWithRefs[]>`
      select f.*,
        coalesce(
          json_agg(s.ref order by l.span_id) filter (where s.id is not null),
          '[]'::json
        ) as span_refs
      from document_compliance.extracted_fields f
      join document_compliance.documents d on d.id = f.document_id
      join document_compliance.prescreen_runs r on r.id = d.run_id
      left join document_compliance.extracted_field_spans l
        on l.extracted_field_id = f.id
      left join document_compliance.spans s on s.id = l.span_id
      where d.run_id = ${runId} and r.owner = ${owner}
      group by f.id
      order by f.id`,
    sql<FindingWithEvidence[]>`
      select f.*,
        coalesce(
          json_agg(json_build_object(
            'document_id', e.document_id,
            'extracted_field_id', e.extracted_field_id,
            'span_id', e.span_id) order by e.id)
          filter (where e.id is not null),
          '[]'::json
        ) as evidence
      from document_compliance.findings f
      join document_compliance.prescreen_runs r on r.id = f.run_id
      left join document_compliance.finding_evidence e on e.finding_id = f.id
      where f.run_id = ${runId} and r.owner = ${owner}
      group by f.id
      order by f.id`,
  ]);
  if (!run) return null;
  const pack = findPack(run.pack_slug);
  // Shared seed files: signed once and reused, so this is usually no request at all.
  const urls = await packPageUrls(
    pack?.documents.flatMap((document) =>
      document.pages.map((page) => storagePath(pack.slug, page)),
    ) ?? [],
  );

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
      for (const row of finding.evidence) {
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
        spanRefs: field.span_refs,
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
    ...run.evaluations.map((evaluation): EvaluationView => {
      const evaluationRulebook = rulebookFromApplied(
        parseAppliedRules(evaluation.rules_applied),
      );
      return {
        number: evaluation.number,
        // json_build_object prints a timestamptz in ISO form already.
        createdAt: evaluation.created_at,
        createdBy: evaluation.created_by,
        rules: evaluationRulebook.applied,
        findings: Array.isArray(evaluation.findings)
          ? (evaluation.findings as FindingView[])
          : [],
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

  const reviews: ReviewView[] = run.reviews.map((row) => ({
    requirementId: row.requirement_id as RequirementId,
    evaluation: row.evaluation,
    findingOutcome: row.finding_outcome,
    outcome: row.outcome,
    note: row.note,
    reviewer: row.reviewer,
    at: row.created_at,
  }));

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

type SessionRunRow = Pick<
  Row<"prescreen_runs">,
  "id" | "pack_slug" | "status" | "created_at" | "completed_at" | "model"
> & {
  metrics: MetricRow[];
  counts: { pass: number; fail: number; needs_review: number };
};

/**
 * An Owner's runs, newest first, each with its cost and Finding counts, in
 * one query: each run's Documents and Findings are folded in by index.
 */
async function listOwnerRuns(
  owner: Owner,
  limit = 20,
): Promise<SessionRunView[]> {
  const rows = await db()<SessionRunRow[]>`
    select r.id, r.pack_slug, r.status, r.created_at, r.completed_at, r.model,
      coalesce((
        select json_agg(json_build_object(
          'model', d.model, 'provider', d.provider,
          'input_tokens', d.input_tokens, 'output_tokens', d.output_tokens,
          'reasoning_tokens', d.reasoning_tokens,
          'cached_input_tokens', d.cached_input_tokens,
          'cost_usd', d.cost_usd, 'parse_ms', d.parse_ms,
          'read_ms', d.read_ms) order by d.id)
        from document_compliance.documents d where d.run_id = r.id
      ), '[]'::json) as metrics,
      (
        select json_build_object(
          'pass', count(*) filter (where f.outcome = 'pass'),
          'fail', count(*) filter (where f.outcome = 'fail'),
          'needs_review', count(*) filter (where f.outcome = 'needs_review'))
        from document_compliance.findings f where f.run_id = r.id
      ) as counts
    from document_compliance.prescreen_runs r
    where r.owner = ${owner}
    order by r.created_at desc
    limit ${limit}`;
  return rows.map((run) => {
    const totals = runTotals(run.metrics.map(documentMetrics));
    return {
      id: run.id,
      packSlug: run.pack_slug,
      status: run.status,
      createdAt: run.created_at,
      completedAt: run.completed_at,
      model: totals.models[0] ?? run.model,
      costUsd: totals.costUsd,
      tokens: totals.inputTokens + totals.outputTokens,
      counts: run.counts,
    };
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

/** The Pre-screen runs in the `document_compliance` schema, on the shared pool. */
export const runRepository: RunRepository = {
  async create(input) {
    const sql = db();
    const [row] = await sql<
      { run_id: string | null; refusal: string | null }[]
    >`
      select run_id, refusal from document_compliance.create_prescreen_run(
        p_owner => ${input.owner}::text,
        p_visitor_hash => ${input.visitorHash}::text,
        p_pack_slug => ${input.packSlug}::text,
        p_rulebook_id => ${input.rulebook.id}::text,
        p_rulebook_version => ${input.rulebook.version}::text,
        p_client_declaration => ${jsonb(sql, input.declaration)},
        p_rules_applied => ${jsonb(sql, input.rulebook.applied)},
        p_model => ${input.model}::text,
        p_per_visitor_per_hour => ${input.limits?.perVisitorPerHour ?? null}::integer,
        p_per_day => ${input.limits?.perDay ?? null}::integer
      )`;
    if (row?.run_id) return { runId: row.run_id };
    return { refusal: row?.refusal === "visitor" ? "visitor" : "day" };
  },

  async latestCompletedId(packSlug, owner) {
    const [latest] = await db()<{ id: string }[]>`
      select id from document_compliance.prescreen_runs
      where owner = ${owner} and pack_slug = ${packSlug} and status = 'completed'
      order by completed_at desc
      limit 1`;
    return latest?.id ?? null;
  },

  async setWorkflowRunId(runId, workflowRunId) {
    await db()`
      update document_compliance.prescreen_runs
      set workflow_run_id = ${workflowRunId}
      where id = ${runId}`;
  },

  async setStatus(runId, status) {
    await db()`
      update document_compliance.prescreen_runs set status = ${status}
      where id = ${runId}`;
  },

  async fail(runId, message) {
    await db()`
      update document_compliance.prescreen_runs
      set status = 'failed', error = ${message.slice(0, 1000)}
      where id = ${runId}`;
  },

  async workflowRunIdOf(runId, owner) {
    const [run] = await db()<{ workflow_run_id: string | null }[]>`
      select workflow_run_id from document_compliance.prescreen_runs
      where id = ${runId} and owner = ${owner}
      limit 1`;
    return run?.workflow_run_id ?? null;
  },

  load: loadRun,

  list: (owner) => listOwnerRuns(owner),

  saveDocument(runId, meta, document) {
    // One transaction: a step that fails part-way and is retried leaves no
    // half-saved Document behind to collide with on `(document_id, ref)`.
    return db().begin(async (tx) => {
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
  },

  async saveFindings(runId, findings, saved) {
    // One transaction: the Findings, their Evidence and the completed status
    // land together, so a retried step never meets its own half-saved Findings.
    await db().begin(async (tx) => {
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
  },

  async recordEvaluation(input) {
    const sql = db();
    try {
      const [row] = await sql<{ number: number }[]>`
        select document_compliance.record_evaluation(
          p_owner => ${input.owner},
          p_run_id => ${input.runId}::uuid,
          p_rules_applied => ${jsonb(sql, input.rules)},
          p_findings => ${jsonb(sql, input.findings)},
          p_created_by => ${input.createdBy},
          p_summary => ${input.summary},
          p_details => ${jsonb(sql, input.details)},
          p_max => ${input.max}::integer
        ) as number`;
      return { number: Number(row?.number) };
    } catch (error) {
      if (raised(error, "limit_reached")) return { refusal: "limit" };
      if (raised(error, "run_not_found")) return { refusal: "gone" };
      throw error;
    }
  },

  async recordReview(input) {
    const sql = db();
    try {
      await sql`
        select document_compliance.record_review(
          p_owner => ${input.owner},
          p_run_id => ${input.runId}::uuid,
          p_evaluation => ${input.evaluation}::integer,
          p_requirement_id => ${input.requirementId},
          p_finding_outcome => ${input.findingOutcome},
          p_outcome => ${input.outcome},
          p_note => ${input.note},
          p_reviewer => ${input.reviewer},
          p_summary => ${input.summary},
          p_details => ${jsonb(sql, input.details)},
          p_max => ${input.max}::integer
        )`;
      return null;
    } catch (error) {
      if (raised(error, "limit_reached")) return { refusal: "limit" };
      if (raised(error, "run_not_found")) return { refusal: "gone" };
      if (raised(error, "stale_evaluation")) return { refusal: "stale" };
      throw error;
    }
  },
};
