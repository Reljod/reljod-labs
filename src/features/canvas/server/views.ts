import "server-only";
import { blocks, checkView } from "../domain/chart-checks";
import { REGIONS } from "../domain/data";
import { LIMITS } from "../domain/limits";
import {
  type MapRegion,
  VIEW_PAYLOAD_KIND,
  type ViewPayload,
  type ViewRecord,
  type ViewWork,
  type WorkRun,
} from "../domain/payload";
import type { CheckFinding } from "../domain/rules";
import { type Verification, verifyView } from "../domain/verify";
import {
  defaultParams,
  mergeParams,
  type ParamValues,
  type QueryResult,
  type ViewSpec,
  viewSpecSchema,
} from "../domain/view";
import type { Caller } from "./caller";
import { type Db, isUuid, jsonb, sql } from "./db";
import {
  InvalidError,
  LimitError,
  NotFoundError,
  RuleRefusal,
} from "./errors";
import {
  type Guarded,
  guardAll,
  type RunContext,
  runContext,
  runGuardedCode,
  runGuardedQuery,
} from "./runs";
import { trail, trailIn } from "./trail";

/*
 * Views (GLOSSARY). A View is made from a spec in the View grammar: its
 * Query is guarded and run, code checks the chart against the Rules, and code
 * recomputes every Claim from the rows. A Control change runs the saved,
 * already guarded Query again with new Parameter values: no model is called.
 */

type Row = {
  id: string;
  conversation_id: string | null;
  spec: ViewSpec;
  params: ParamValues;
  result: QueryResult;
  verification: Verification;
  findings: CheckFinding[];
  status: "verified" | "flagged";
  rulebook_version: number;
  work: ViewWork;
  guarded: Guarded;
  revision: number;
  created_at: Date;
  updated_at: Date;
};

const recordOf = (row: Row): ViewRecord => ({
  id: row.id,
  conversationId: row.conversation_id,
  revision: row.revision,
  spec: row.spec,
  params: row.params,
  result: row.result,
  verification: row.verification,
  findings: row.findings,
  status: row.status,
  rulebookVersion: row.rulebook_version,
  work: row.work,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const MAP_REGIONS: MapRegion[] = REGIONS.map((region) => ({
  code: region.code,
  name: region.name,
  centroid: region.centroid as [number, number],
  polygon: region.polygon as [number, number][],
}));

/** What the App draws from: the View, and the map when it is one. */
export function payloadOf(view: ViewRecord, linked?: ViewRecord[]): ViewPayload {
  return {
    kind: VIEW_PAYLOAD_KIND,
    view,
    ...(view.spec.encoding.kind === "map" ? { regions: MAP_REGIONS } : {}),
    ...(linked && linked.length > 0 ? { linked } : {}),
  };
}

const sameParams = (a: ParamValues, b: ParamValues) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
};

/** How many of a Run a View keeps under Show the work. */
const RUNS_KEPT = 6;

// Computing a View ---------------------------------------------------------------------------

type Computed = {
  result: QueryResult;
  verification: Verification;
  findings: CheckFinding[];
  status: "verified" | "flagged";
  guarded: Guarded;
  runs: WorkRun[];
};

/**
 * Runs a spec's Query with the given Parameter values and checks what came
 * back. `guarded` is the Guard's earlier verdict, used again while the
 * Rulebook has not changed since.
 */
async function compute(
  caller: Caller,
  context: RunContext,
  spec: ViewSpec,
  params: ParamValues,
  guarded: Guarded | null,
  label: string,
  atOrigin: { status: "verified" | "flagged" } | null,
): Promise<Computed> {
  const query = spec.query;
  const passed =
    guarded && guarded.rulebookVersion === context.rulebookVersion
      ? guarded
      : await guardAll(
          caller,
          context,
          query.kind === "sql" ? [{ sql: query.sql }] : query.inputs,
          params,
        );
  const ran =
    query.kind === "sql"
      ? await runGuardedQuery(caller, context, passed.statements[0], params, label)
      : await runGuardedCode(
          caller,
          context,
          passed.statements,
          query.code,
          params,
          label,
          true,
        );
  const findings = checkView(spec, ran.result, context.rules);
  if (blocks(findings)) {
    const blocking = findings.filter((finding) => finding.outcome === "block");
    throw new RuleRefusal(
      blocking[0].rule,
      blocking.map((finding) => finding.message).join(" "),
    );
  }
  const checked = verifyView(spec, ran.result, context.rules, params);
  // Away from the spec's own values there is nothing narrated to compare
  // with: each Claim shows what code computes, and the stamp stays as it was.
  const verification: Verification =
    atOrigin === null
      ? checked
      : {
          ...checked,
          status: atOrigin.status,
          reasons: [],
          claims: checked.claims.map((claim) => ({
            ...claim,
            stated: claim.actual ?? claim.stated,
            ok: claim.actual !== null,
          })),
        };
  return {
    result: ran.result,
    verification,
    findings,
    status: verification.status,
    guarded: passed,
    runs: [ran.run],
  };
}

const workOf = (
  context: RunContext,
  guarded: Guarded,
  runs: WorkRun[],
): ViewWork => {
  const restrictedUsed = [
    ...new Set(guarded.statements.flatMap((item) => item.restrictedUsed)),
  ].sort();
  return {
    tables: [...new Set(guarded.statements.flatMap((item) => item.tables))].sort(),
    restrictedUsed,
    minGroupSize: guarded.statements.some((item) => item.guardedSelects > 0)
      ? context.rules.minGroupSize
      : null,
    runs: runs.slice(-RUNS_KEPT),
  };
};

/** A spec as the Analyst or a client sent it, checked against the grammar. */
export function parseSpec(input: unknown): ViewSpec {
  const parsed = viewSpecSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new InvalidError(
    `The View spec is not valid canvas.view/1: ${parsed.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join(".") || "spec"}: ${issue.message}`)
      .join("; ")}`,
  );
}

// Reading ------------------------------------------------------------------------------------

async function load(db: Db, caller: Pick<Caller, "owner">, id: string) {
  if (!isUuid(id)) throw new NotFoundError("No such View.");
  const [row] = await db<Row[]>`
    select * from canvas.views
    where id = ${id} and owner = ${caller.owner}`;
  if (!row) throw new NotFoundError("No such View.");
  return row;
}

export async function getView(caller: Pick<Caller, "owner">, id: string) {
  return recordOf(await load(sql(), caller, id));
}

/** The Views of a Conversation, oldest first; or, with no Conversation, the Owner's latest. */
export async function listViews(
  caller: Pick<Caller, "owner">,
  conversationId?: string,
): Promise<ViewRecord[]> {
  const db = sql();
  const rows = isUuid(conversationId)
    ? await db<Row[]>`
        select * from canvas.views
        where owner = ${caller.owner} and conversation_id = ${conversationId}
        order by created_at
        limit ${LIMITS.viewsPerConversation}`
    : await db<Row[]>`
        select * from canvas.views
        where owner = ${caller.owner}
        order by created_at desc
        limit 40`;
  return rows.map(recordOf);
}

// Writing ------------------------------------------------------------------------------------

/**
 * `create_view`: makes a View from a spec, or, with `replaces`, revises one
 * in place (the Analyst fixing a Flagged View). A spec that breaks a
 * blocking Rule is refused and nothing is saved.
 */
export async function createView(
  caller: Caller,
  input: { spec: unknown; replaces?: string },
): Promise<ViewRecord> {
  const spec = parseSpec(input.spec);
  const db = sql();
  const replaced = input.replaces ? await load(db, caller, input.replaces) : null;
  if (!replaced && isUuid(caller.conversationId)) {
    const [count] = await db<{ n: number }[]>`
      select count(*)::int as n from canvas.views
      where owner = ${caller.owner} and conversation_id = ${caller.conversationId}`;
    if ((count?.n ?? 0) >= LIMITS.viewsPerConversation)
      throw new LimitError(
        `A Conversation holds at most ${LIMITS.viewsPerConversation} Views. Start a new one.`,
      );
  }
  const context = await runContext(caller);
  const params = defaultParams(spec);
  let computed: Computed;
  try {
    computed = await compute(caller, context, spec, params, null, "View Query", null);
  } catch (error) {
    if (error instanceof InvalidError)
      await trail(caller, {
        action: "view.refused",
        summary: `View "${spec.title}" refused: ${error.message}`.slice(0, 280),
        detail: {
          title: spec.title,
          kind: spec.encoding.kind,
          rule: error instanceof RuleRefusal ? error.rule : null,
          reason: error.message,
        },
      });
    throw error;
  }
  const work = workOf(context, computed.guarded, [
    ...(replaced?.work.runs ?? []),
    ...computed.runs,
  ]);
  return db.begin(async (tx) => {
    const [row] = replaced
      ? await tx<Row[]>`
          update canvas.views set
            spec = ${jsonb(tx, spec)}, params = ${jsonb(tx, params)},
            result = ${jsonb(tx, computed.result)},
            verification = ${jsonb(tx, computed.verification)},
            findings = ${jsonb(tx, computed.findings)}, status = ${computed.status},
            rulebook_version = ${context.rulebookVersion}, work = ${jsonb(tx, work)},
            guarded = ${jsonb(tx, computed.guarded)}, revision = revision + 1,
            updated_at = now()
          where id = ${replaced.id} and owner = ${caller.owner}
          returning *`
      : await tx<Row[]>`
          insert into canvas.views (
            owner, conversation_id, spec, params, result, verification, findings,
            status, rulebook_version, work, guarded
          ) values (
            ${caller.owner}, ${isUuid(caller.conversationId) ? caller.conversationId : null},
            ${jsonb(tx, spec)}, ${jsonb(tx, params)}, ${jsonb(tx, computed.result)},
            ${jsonb(tx, computed.verification)}, ${jsonb(tx, computed.findings)},
            ${computed.status}, ${context.rulebookVersion}, ${jsonb(tx, work)},
            ${jsonb(tx, computed.guarded)}
          )
          returning *`;
    if (!row) throw new NotFoundError("No such View.");
    await trailIn(tx, caller, {
      action: "view.created",
      summary: `${replaced ? "Revised" : "Made"} ${spec.encoding.kind} View "${spec.title}": ${computed.status}`,
      viewId: row.id,
      detail: {
        kind: spec.encoding.kind,
        status: computed.status,
        rows: computed.result.rowCount,
        claims: computed.verification.claims,
        reasons: computed.verification.reasons,
        findings: computed.findings,
        spec,
        rulebookVersion: context.rulebookVersion,
        revised: Boolean(replaced),
      },
    });
    return recordOf(row);
  });
}

async function save(
  tx: Db,
  caller: Caller,
  row: Row,
  context: RunContext,
  params: ParamValues,
  computed: Computed,
) {
  const work = workOf(context, computed.guarded, [
    ...row.work.runs,
    ...computed.runs,
  ]);
  const [saved] = await tx<Row[]>`
    update canvas.views set
      params = ${jsonb(tx, params)}, result = ${jsonb(tx, computed.result)},
      verification = ${jsonb(tx, computed.verification)},
      findings = ${jsonb(tx, computed.findings)}, status = ${computed.status},
      rulebook_version = ${context.rulebookVersion}, work = ${jsonb(tx, work)},
      guarded = ${jsonb(tx, computed.guarded)}, revision = revision + 1,
      updated_at = now()
    where id = ${row.id} and owner = ${caller.owner}
    returning *`;
  if (!saved) throw new NotFoundError("No such View.");
  return saved;
}

/** Views that share a Conversation or a Board with this one. */
async function neighbours(caller: Caller, row: Row) {
  return sql()<Row[]>`
    select v.* from canvas.views v
    where v.owner = ${caller.owner} and v.id <> ${row.id}
      and (
        (v.conversation_id is not null and v.conversation_id = ${row.conversation_id})
        or exists (
          select 1 from canvas.board_items a
          join canvas.board_items b on b.board_id = a.board_id
          where a.view_id = ${row.id} and b.view_id = v.id
        )
      )
    order by v.created_at
    limit 40`;
}

const LINKED_MAX = 4;

/**
 * `update_view_params`: a Control, a Brush or a drill-down changed
 * Parameters. Runs the View's saved Query again with the new values, and
 * does the same for Linked Views (those beside it that declare a Parameter
 * of the same name and type). No model is called.
 */
export async function updateViewParams(
  caller: Caller,
  input: { viewId: string; params: Record<string, unknown> },
): Promise<{ view: ViewRecord; linked: ViewRecord[] }> {
  const row = await load(sql(), caller, input.viewId);
  const merged = mergeParams(row.spec, row.params, input.params);
  if (merged.errors.length > 0) throw new InvalidError(merged.errors.join(" "));
  const context = await runContext(caller);
  const run = async (target: Row, params: ParamValues, label: string) => {
    const computed = await compute(
      caller,
      context,
      target.spec,
      params,
      target.guarded,
      label,
      sameParams(params, defaultParams(target.spec))
        ? null
        : // The stamp earned at the spec's own values stays.
          { status: target.status },
    );
    return sql().begin(async (tx) => {
      const saved = await save(tx, caller, target, context, params, computed);
      await trailIn(tx, caller, {
        action: "view.updated",
        summary: `"${target.spec.title}": ${Object.entries(params)
          .map(([name, value]) => `${name}=${value}`)
          .join(", ")
          .slice(0, 160)} → ${computed.result.rowCount} rows`,
        viewId: target.id,
        detail: {
          params,
          rows: computed.result.rowCount,
          ms: computed.result.ms,
          linkedFrom: target.id === row.id ? null : row.id,
          model: null,
        },
        ms: computed.result.ms,
      });
      return recordOf(saved);
    });
  };
  const view = await run(row, merged.values, "Control change");
  // Linked Views: the same Parameter name and type, beside this View.
  const changed = Object.keys(input.params).filter(
    (name) => merged.values[name] !== row.params[name],
  );
  const linked: ViewRecord[] = [];
  if (changed.length > 0) {
    const candidates = (await neighbours(caller, row))
      .map((other) => {
        const changes: Record<string, unknown> = {};
        for (const name of changed) {
          const mine = row.spec.params.find((param) => param.name === name);
          const theirs = other.spec.params.find((param) => param.name === name);
          if (mine && theirs && mine.type === theirs.type)
            changes[name] = merged.values[name];
        }
        return { other, changes };
      })
      .filter((item) => Object.keys(item.changes).length > 0)
      .slice(0, LINKED_MAX);
    const results = await Promise.allSettled(
      candidates.map(({ other, changes }) => {
        const next = mergeParams(other.spec, other.params, changes);
        return next.errors.length > 0 || sameParams(next.values, other.params)
          ? Promise.resolve(null)
          : run(other, next.values, "Linked View");
      }),
    );
    for (const result of results)
      if (result.status === "fulfilled" && result.value) linked.push(result.value);
  }
  return { view, linked };
}

export type RefreshChange = {
  viewId: string;
  title: string;
  ok: boolean;
  /** What changed, in words; empty when nothing did. */
  changes: string[];
  error: string | null;
  statusBefore: "verified" | "flagged";
  statusAfter: "verified" | "flagged" | null;
  rowsBefore: number;
  rowsAfter: number | null;
  ms: number;
};

const show = (value: number | null) =>
  value === null ? "nothing" : String(Math.round(value * 1000) / 1000);

/**
 * Runs a View's Query again as it stands (same spec, same Parameter values)
 * under the Rules as they are now, and says what changed. No model is
 * called. A Query the Rules now refuse leaves the View as it was and is
 * reported.
 */
export async function refreshView(
  caller: Caller,
  viewId: string,
): Promise<RefreshChange> {
  const started = Date.now();
  const row = await load(sql(), caller, viewId);
  const before = recordOf(row);
  const base = {
    viewId: row.id,
    title: row.spec.title,
    statusBefore: row.status,
    rowsBefore: row.result.rowCount,
  };
  try {
    const context = await runContext(caller);
    const atOrigin = sameParams(row.params, defaultParams(row.spec));
    const computed = await compute(
      caller,
      context,
      row.spec,
      row.params,
      // Parsed again: the Catalog or the Rules may have changed under it.
      null,
      "Refresh",
      atOrigin ? null : { status: row.status },
    );
    const changes: string[] = [];
    if (computed.status !== row.status)
      changes.push(`${row.status} → ${computed.status}`);
    if (computed.result.rowCount !== row.result.rowCount)
      changes.push(
        `${row.result.rowCount} → ${computed.result.rowCount} rows`,
      );
    for (const claim of computed.verification.claims) {
      const old = before.verification.claims.find((item) => item.id === claim.id);
      if (old && old.actual !== claim.actual)
        changes.push(`${claim.label}: ${show(old.actual)} → ${show(claim.actual)}`);
    }
    if (context.rulebookVersion !== row.rulebook_version)
      changes.push(
        `checked under Rulebook v${context.rulebookVersion} (was v${row.rulebook_version})`,
      );
    const newFindings = computed.findings.filter(
      (finding) =>
        !row.findings.some((old) => old.rule === finding.rule),
    );
    for (const finding of newFindings) changes.push(finding.message);
    await sql().begin(async (tx) => {
      await save(tx, caller, row, context, row.params, computed);
      await trailIn(tx, caller, {
        action: "view.refreshed",
        summary: `"${row.spec.title}": ${changes.length > 0 ? changes.join("; ").slice(0, 200) : "no change"}`,
        viewId: row.id,
        detail: { changes, rows: computed.result.rowCount, model: null },
        ms: Date.now() - started,
      });
    });
    return {
      ...base,
      ok: true,
      changes,
      error: null,
      statusAfter: computed.status,
      rowsAfter: computed.result.rowCount,
      ms: Date.now() - started,
    };
  } catch (error) {
    if (!(error instanceof InvalidError || error instanceof LimitError))
      throw error;
    await trail(caller, {
      action: "view.refreshed",
      summary: `"${row.spec.title}" could not be refreshed: ${error.message}`.slice(0, 280),
      viewId: row.id,
      detail: { ok: false, error: error.message },
      ms: Date.now() - started,
    });
    return {
      ...base,
      ok: false,
      changes: [],
      error: error.message,
      statusAfter: null,
      rowsAfter: null,
      ms: Date.now() - started,
    };
  }
}

/** Deletes a View; it leaves every Board that held it. */
export async function deleteView(caller: Caller, id: string) {
  const row = await load(sql(), caller, id);
  await sql().begin(async (tx) => {
    await tx`delete from canvas.views where id = ${row.id} and owner = ${caller.owner}`;
    await trailIn(tx, caller, {
      action: "view.deleted",
      summary: `Deleted View "${row.spec.title}"`,
      viewId: row.id,
      detail: { title: row.spec.title },
    });
  });
}
