import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { InvalidError, LimitError, NotFoundError } from "@/platform/errors";
import { blocks, checkView } from "../../domain/chart-checks";
import { REGIONS } from "../../domain/data";
import { LIMITS } from "../../domain/limits";
import {
  type MapRegion,
  VIEW_PAYLOAD_KIND,
  type ViewPayload,
  type ViewRecord,
  type ViewWork,
  type WorkRun,
} from "../../domain/payload";
import type { CheckFinding } from "../../domain/rules";
import { type Verification, verifyView } from "../../domain/verify";
import {
  defaultParams,
  mergeParams,
  type ParamValues,
  type QueryResult,
  type ViewSpec,
  viewSpecSchema,
} from "../../domain/view";
import { RuleRefusal } from "../errors";
import type {
  Caller,
  Guarded,
  StoredView,
  TrailRepository,
  ViewRepository,
} from "../ports";
import type { RunContext, RunService } from "./runs";

/*
 * Views (GLOSSARY). A View is made from a spec in the View grammar: its
 * Query is guarded and run, code checks the chart against the Rules, and code
 * recomputes every Claim from the rows. A Control change runs the saved,
 * already guarded Query again with new Parameter values: no model is called.
 */

export interface ViewService {
  get(owner: Owner, id: string): Promise<ViewRecord>;
  /** The Views of a Conversation, oldest first; or, with no Conversation, the Owner's latest. */
  list(owner: Owner, conversationId?: string): Promise<ViewRecord[]>;
  /**
   * `create_view`: makes a View from a spec, or, with `replaces`, revises
   * one in place (the Analyst fixing a Flagged View). A spec that breaks a
   * blocking Rule is refused and nothing is saved.
   */
  create(
    caller: Caller,
    input: { spec: unknown; replaces?: string },
  ): Promise<ViewRecord>;
  /**
   * `update_view_params`: a Control, a Brush or a drill-down changed
   * Parameters. Runs the View's saved Query again with the new values, and
   * does the same for Linked Views. No model is called.
   */
  updateParams(
    caller: Caller,
    input: { viewId: string; params: Record<string, unknown> },
  ): Promise<{ view: ViewRecord; linked: ViewRecord[] }>;
}

const MAP_REGIONS: MapRegion[] = REGIONS.map((region) => ({
  code: region.code,
  name: region.name,
  centroid: region.centroid as [number, number],
  polygon: region.polygon as [number, number][],
}));

/** What the App draws from: the View, and the map when it is one. */
export function payloadOf(
  view: ViewRecord,
  linked?: ViewRecord[],
): ViewPayload {
  return {
    kind: VIEW_PAYLOAD_KIND,
    view,
    ...(view.spec.encoding.kind === "map" ? { regions: MAP_REGIONS } : {}),
    ...(linked && linked.length > 0 ? { linked } : {}),
  };
}

/** A View as the outside world sees it: without the Guard's saved verdict. */
export const recordOf = ({
  guarded: _guarded,
  ...view
}: StoredView): ViewRecord => view;

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

const sameParams = (a: ParamValues, b: ParamValues) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
};

/** How many of a Run a View keeps under Show the work. */
const RUNS_KEPT = 6;
/** Linked Views run again at most per change, and looked at. */
const LINKED_MAX = 4;
const NEIGHBOURS = 40;
/** The Owner's latest Views, with no Conversation named. */
const LATEST = 40;

type Computed = {
  result: QueryResult;
  verification: Verification;
  findings: CheckFinding[];
  status: "verified" | "flagged";
  guarded: Guarded;
  runs: WorkRun[];
};

const workOf = (
  context: RunContext,
  guarded: Guarded,
  runs: WorkRun[],
): ViewWork => ({
  tables: [
    ...new Set(guarded.statements.flatMap((item) => item.tables)),
  ].sort(),
  restrictedUsed: [
    ...new Set(guarded.statements.flatMap((item) => item.restrictedUsed)),
  ].sort(),
  minGroupSize: guarded.statements.some((item) => item.guardedSelects > 0)
    ? context.rules.minGroupSize
    : null,
  runs: runs.slice(-RUNS_KEPT),
});

export function createViewService(ports: {
  views: ViewRepository;
  runs: RunService;
  trail: TrailRepository;
}): ViewService {
  const { views, runs, trail } = ports;

  async function load(owner: Owner, id: string) {
    const view = await views.get(owner, id);
    if (!view) throw new NotFoundError("No such View.");
    return view;
  }

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
    // A fresh Guard verdict took the Run from the allowance already.
    const reused =
      guarded !== null && guarded.rulebookVersion === context.rulebookVersion;
    const passed =
      reused && guarded
        ? guarded
        : await runs.guard(
            caller,
            context,
            query.kind === "sql" ? [{ sql: query.sql }] : query.inputs,
            params,
          );
    const ran =
      query.kind === "sql"
        ? await runs.runQuery(
            caller,
            context,
            passed.statements[0],
            params,
            label,
            { admitted: !reused },
          )
        : await runs.runCode(
            caller,
            context,
            passed.statements,
            query.code,
            params,
            label,
            { needsTable: true, admitted: !reused },
          );
    // A Control may filter a View down to nothing: that is an answer ("no days
    // above the threshold"), and the App says so. A new View with no rows is not.
    const emptied = atOrigin !== null && ran.result.rowCount === 0;
    const findings = emptied ? [] : checkView(spec, ran.result, context.rules);
    if (blocks(findings)) {
      const blocking = findings.filter(
        (finding) => finding.outcome === "block",
      );
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

  return {
    get: async (owner, id) => recordOf(await load(owner, id)),

    async list(owner, conversationId) {
      const rows = await views.list(
        owner,
        conversationId,
        conversationId ? LIMITS.viewsPerConversation : LATEST,
      );
      return rows.map(recordOf);
    },

    async create(caller, input) {
      const spec = parseSpec(input.spec);
      const [replaced, inConversation, context] = await Promise.all([
        input.replaces ? load(caller.owner, input.replaces) : null,
        !input.replaces && caller.conversationId
          ? views.countInConversation(caller.owner, caller.conversationId)
          : 0,
        runs.context(caller.owner),
      ]);
      if (inConversation >= LIMITS.viewsPerConversation)
        throw new LimitError(
          `A Conversation holds at most ${LIMITS.viewsPerConversation} Views. Start a new one.`,
        );
      const params = defaultParams(spec);
      let computed: Computed;
      try {
        computed = await compute(
          caller,
          context,
          spec,
          params,
          null,
          "View Query",
          null,
        );
      } catch (error) {
        if (error instanceof InvalidError)
          await trail.record(caller, {
            action: "view.refused",
            summary: `View "${spec.title}" refused: ${error.message}`.slice(
              0,
              280,
            ),
            detail: {
              title: spec.title,
              kind: spec.encoding.kind,
              rule: error instanceof RuleRefusal ? error.rule : null,
              reason: error.message,
            },
          });
        throw error;
      }
      const values = {
        spec,
        params,
        result: computed.result,
        verification: computed.verification,
        findings: computed.findings,
        status: computed.status,
        rulebookVersion: context.rulebookVersion,
        work: workOf(context, computed.guarded, [
          ...(replaced?.work.runs ?? []),
          ...computed.runs,
        ]),
        guarded: computed.guarded,
      };
      const event = (viewId: string) => ({
        action: "view.created" as const,
        summary: `${replaced ? "Revised" : "Made"} ${spec.encoding.kind} View "${spec.title}": ${computed.status}`,
        viewId,
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
      const saved = replaced
        ? await views.update(caller, replaced.id, values, event(replaced.id))
        : await views.insert(caller, values, event);
      if (!saved) throw new NotFoundError("No such View.");
      return recordOf(saved);
    },

    async updateParams(asked, input) {
      const row = await load(asked.owner, input.viewId);
      // The Trail files the change under the View's own Conversation, read from
      // the Owner's row: never under an id the caller sent.
      const caller: Caller = {
        ...asked,
        conversationId: row.conversationId ?? undefined,
      };
      const merged = mergeParams(row.spec, row.params, input.params);
      if (merged.errors.length > 0)
        throw new InvalidError(merged.errors.join(" "));
      const context = await runs.context(caller.owner);
      const run = async (
        target: StoredView,
        params: ParamValues,
        label: string,
      ) => {
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
        const saved = await views.update(
          caller,
          target.id,
          {
            params,
            result: computed.result,
            verification: computed.verification,
            findings: computed.findings,
            status: computed.status,
            rulebookVersion: context.rulebookVersion,
            work: workOf(context, computed.guarded, [
              ...target.work.runs,
              ...computed.runs,
            ]),
            guarded: computed.guarded,
          },
          {
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
          },
        );
        if (!saved) throw new NotFoundError("No such View.");
        return recordOf(saved);
      };
      const view = await run(row, merged.values, "Control change");
      // Linked Views: the same Parameter name and type, beside this View.
      const changed = Object.keys(input.params).filter(
        (name) => merged.values[name] !== row.params[name],
      );
      const linked: ViewRecord[] = [];
      if (changed.length > 0) {
        const candidates = (
          await views.neighbours(caller.owner, row, NEIGHBOURS)
        )
          .map((other) => {
            const changes: Record<string, unknown> = {};
            for (const name of changed) {
              const mine = row.spec.params.find((param) => param.name === name);
              const theirs = other.spec.params.find(
                (param) => param.name === name,
              );
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
            return next.errors.length > 0 ||
              sameParams(next.values, other.params)
              ? Promise.resolve(null)
              : run(other, next.values, "Linked View");
          }),
        );
        for (const result of results)
          if (result.status === "fulfilled" && result.value)
            linked.push(result.value);
      }
      return { view, linked };
    },
  };
}
