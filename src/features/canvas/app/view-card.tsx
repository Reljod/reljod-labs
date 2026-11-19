/** @jsxImportSource preact */
import type { ComponentType } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ViewPayload, ViewRecord } from "../domain/payload";
import type {
  Control,
  ParamValue,
  ParamValues,
  ViewKind,
  ViewSpec,
} from "../domain/view";
import {
  createSequence,
  DEBOUNCE_MS,
  modelContextText,
  readToolResult,
  supersedes,
  type ToolResult,
} from "./bridge";
import { Cartesian } from "./cartesian";
import { assignSlots, type Theme } from "./colors";
import { formatNumber, formatTime, formatValue, parseTime } from "./format";
import {
  changedParams,
  encodingFields,
  eyebrowOf,
  missingFields,
  specParams,
} from "./model";
import { type Act, type ChartProps, Empty, useWidth } from "./plot";
import { StatView } from "./stat";
import { RowsTable, TableView } from "./table";
import { tokenize } from "./tokenize";

/** One View, top to bottom: header, Controls, plot, Finding, Check findings, Show the work. */

export type CardHost = {
  /** False when the Host cannot proxy `tools/call`. */
  canRun: boolean;
  run: (viewId: string, params: ParamValues) => Promise<ToolResult>;
  /** Tells the model what the person is looking at, when the Host takes it. */
  tell: (text: string) => void;
};

// biome-ignore lint/suspicious/noExplicitAny: each chart narrows its own encoding.
type Chart = ComponentType<ChartProps<any>>;

/** The kinds this build draws. A kind not listed falls back to its rows. */
export const CHARTS: Partial<Record<ViewKind, Chart>> = {
  line: Cartesian,
  area: Cartesian,
  bar: Cartesian,
  table: TableView,
  stat: StatView,
};

const Check = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path
      d="M2 6.5l2.8 2.8L10 3.4"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    />
  </svg>
);

const Flag = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path
      d="M3 11.5V1.5h6.8L8.2 4.3l1.6 2.8H3"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linejoin="round"
    />
  </svg>
);

function Stamp({ view, onOpen }: { view: ViewRecord; onOpen: () => void }) {
  const verified = view.status === "verified";
  const reasons = verified
    ? [
        view.verification.claims.length
          ? `Every Claim matches the rows within ${view.verification.tolerancePct}%.`
          : "The Finding states no figure the rows do not back.",
      ]
    : view.verification.reasons.length
      ? view.verification.reasons
      : ["A Claim does not match the rows."];
  return (
    <button
      type="button"
      class={`stamp ${verified ? "verified" : "flagged"}`}
      onClick={onOpen}
      aria-label={`${verified ? "Verified" : "Flagged"}. ${reasons.join(" ")} Show the work.`}
    >
      {verified ? <Check /> : <Flag />}
      {verified ? "Verified" : "Flagged"}
      <span class="why" role="tooltip">
        {reasons.map((reason) => (
          <span key={reason}>{reason}</span>
        ))}
      </span>
    </button>
  );
}

const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

function ControlInput({
  control,
  spec,
  act,
}: {
  control: Control;
  spec: ViewSpec;
  act: Act;
}) {
  const off = !act.enabled;
  if (control.kind === "slider") {
    const value = Number(act.values[control.param] ?? control.min);
    const text = `${formatNumber(value)}${control.unit ? ` ${control.unit}` : ""}`;
    return (
      <label class="control slider">
        <span class="eyebrow">
          {control.label} <output>{text}</output>
        </span>
        <input
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={value}
          disabled={off}
          aria-valuetext={text}
          onInput={(event) =>
            act.set({ [control.param]: Number(event.currentTarget.value) })
          }
        />
      </label>
    );
  }
  if (control.kind === "select") {
    const numeric =
      spec.params.find((param) => param.name === control.param)?.type ===
      "number";
    return (
      <label class="control">
        <span class="eyebrow">{control.label}</span>
        <select
          class="field"
          disabled={off}
          value={String(act.values[control.param] ?? "")}
          onChange={(event) => {
            const picked = event.currentTarget.value;
            act.set({ [control.param]: numeric ? Number(picked) : picked });
          }}
        >
          {control.options.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const from = String(act.values[control.from] ?? control.min);
  const to = String(act.values[control.to] ?? control.max);
  return (
    <fieldset
      class="control"
      style={{ border: 0, padding: 0, margin: 0 }}
      disabled={off}
    >
      <legend class="eyebrow" style={{ padding: 0, marginBottom: "3px" }}>
        {control.label}
      </legend>
      <div class="pair">
        <input
          class="field"
          type="date"
          aria-label={`${control.label}, from`}
          min={control.min}
          max={to < control.max ? to : control.max}
          value={from}
          onChange={(event) => {
            const picked = event.currentTarget.value;
            if (isDate(picked) && picked <= to)
              act.set({ [control.from]: picked });
          }}
        />
        <span aria-hidden="true">to</span>
        <input
          class="field"
          type="date"
          aria-label={`${control.label}, to`}
          min={from > control.min ? from : control.min}
          max={control.max}
          value={to}
          onChange={(event) => {
            const picked = event.currentTarget.value;
            if (isDate(picked) && picked >= from)
              act.set({ [control.to]: picked });
          }}
        />
      </div>
    </fieldset>
  );
}

/** The Brush from the keyboard: two inputs behind a "Set range" button. */
function BrushRange({
  brush,
  spec,
  act,
}: {
  brush: { from: string; to: string };
  spec: ViewSpec;
  act: Act;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const type = (name: string) =>
    spec.params.find((param) => param.name === name)?.type ?? "text";
  const input = (name: string) =>
    type(name) === "date" ? "date" : type(name) === "number" ? "number" : "text";
  const read = (name: string, text: string): ParamValue | null => {
    if (type(name) === "number")
      return text.trim() !== "" && Number.isFinite(Number(text))
        ? Number(text)
        : null;
    if (type(name) === "date") return isDate(text) ? text : null;
    return text;
  };
  if (!open)
    return (
      <div class="control">
        <span class="eyebrow">Brush</span>
        <div class="pair">
          <span class="note">Drag across the chart to choose a range.</span>
          <button
            type="button"
            class="btn"
            disabled={!act.enabled}
            onClick={() => {
              setFrom(String(act.values[brush.from] ?? ""));
              setTo(String(act.values[brush.to] ?? ""));
              setOpen(true);
            }}
          >
            Set range
          </button>
        </div>
      </div>
    );
  return (
    <form
      class="control"
      onSubmit={(event) => {
        event.preventDefault();
        const [first, second] = [read(brush.from, from), read(brush.to, to)];
        if (first === null || second === null || first > second) return;
        act.set({ [brush.from]: first, [brush.to]: second });
        setOpen(false);
      }}
    >
      <span class="eyebrow">Brush range</span>
      <div class="pair">
        <input
          class="field"
          type={input(brush.from)}
          aria-label="Range from"
          value={from}
          onInput={(event) => setFrom(event.currentTarget.value)}
        />
        <span aria-hidden="true">to</span>
        <input
          class="field"
          type={input(brush.to)}
          aria-label="Range to"
          value={to}
          onInput={(event) => setTo(event.currentTarget.value)}
        />
        <button type="submit" class="btn">
          Apply
        </button>
        <button type="button" class="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Controls({
  spec,
  act,
  error,
  snapshot,
}: {
  spec: ViewSpec;
  act: Act;
  error: string | null;
  snapshot: boolean;
}) {
  const brush =
    "brush" in spec.encoding && spec.encoding.brush
      ? spec.encoding.brush
      : null;
  const drill =
    (spec.encoding.kind === "table" || spec.encoding.kind === "map") &&
    spec.encoding.drill
      ? spec.encoding.drill.param
      : null;
  const changed = changedParams(spec, act.values);
  if (spec.controls.length === 0 && !brush && !(drill && changed.length))
    return error ? (
      <section class="controls">
        <p class="error" role="alert">
          {error}
        </p>
      </section>
    ) : null;
  return (
    <section class="controls" aria-label="Controls">
      {spec.controls.map((control) => (
        <ControlInput
          key={control.kind === "date_range" ? control.from : control.param}
          control={control}
          spec={spec}
          act={act}
        />
      ))}
      {brush ? <BrushRange brush={brush} spec={spec} act={act} /> : null}
      {changed.length > 0 && act.enabled ? (
        <button
          type="button"
          class="btn"
          onClick={() => act.set(act.defaults)}
        >
          Reset
        </button>
      ) : null}
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
      {!act.enabled && !snapshot ? (
        <p class="note">This Host cannot run Queries from a View.</p>
      ) : null}
    </section>
  );
}

function Finding({ view }: { view: ViewRecord }) {
  const { spec, verification } = view;
  if (!spec.finding && verification.claims.length === 0) return null;
  const stale = changedParams(spec, view.params).length > 0;
  return (
    <section class={stale ? "finding stale" : "finding"}>
      <h2 class="eyebrow">Finding</h2>
      {spec.finding ? <p class="words">{spec.finding}</p> : null}
      {stale && spec.finding ? (
        <p class="note">
          Written for the starting values; the numbers below are live.
        </p>
      ) : null}
      {verification.claims.length ? (
        <ul class="chips" aria-label="Claims">
          {verification.claims.map((claim) => {
            const fmt = { format: claim.format, unit: claim.unit };
            return (
              <li key={claim.id} class={claim.ok ? "chip ok" : "chip no"}>
                {claim.ok ? <Check /> : <Flag />}
                <span>{claim.label}</span>
                <b>
                  {claim.actual === null
                    ? "not computed"
                    : formatValue(claim.actual, fmt)}
                </b>
                {claim.ok ? (
                  <span class="sr">Verified</span>
                ) : (
                  <span>
                    {claim.actual === null
                      ? (claim.note ?? "could not be recomputed")
                      : `says ${formatValue(claim.stated, fmt)}, data says ${formatValue(claim.actual, fmt)}`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function Code({ text, language }: { text: string; language: "sql" | "python" }) {
  const tokens = useMemo(() => tokenize(text, language), [text, language]);
  return (
    <pre>
      <code>
        {tokens.map((token, index) =>
          token.kind ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional.
            <span key={index} class={token.kind}>
              {token.text}
            </span>
          ) : (
            token.text
          ),
        )}
      </code>
    </pre>
  );
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"" | "copied" | "selected">("");
  const copy = async (event: MouseEvent) => {
    const button = event.currentTarget as HTMLElement;
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // A sandboxed frame may not write the clipboard: select the text instead.
      const block = button.closest("div")?.querySelector("pre");
      const selection = window.getSelection();
      if (block && selection) {
        const range = document.createRange();
        range.selectNodeContents(block);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setState("selected");
    }
  };
  return (
    <button type="button" class="btn" onClick={copy}>
      {state === "copied"
        ? "Copied"
        : state === "selected"
          ? "Selected: press Ctrl+C"
          : "Copy SQL"}
    </button>
  );
}

function Work({ view, theme }: { view: ViewRecord; theme: Theme }) {
  const { spec, work, verification, result } = view;
  const [rows, setRows] = useState(false);
  const query = spec.query;
  const sql =
    query.kind === "sql"
      ? query.sql
      : query.inputs.map((input) => `-- ${input.name}\n${input.sql}`).join("\n\n");
  const guarded = [...work.runs]
    .reverse()
    .find((run) => run.guardedSql && run.guardedSql !== run.text);
  const fmtClaim = (value: number | null, claim: { format?: ViewSpec["claims"][number]["format"]; unit?: string }) =>
    value === null ? "not computed" : formatValue(value, claim);
  const updated = parseTime(view.updatedAt);
  return (
    <div class="work">
      <div>
        <h3 class="eyebrow">
          {query.kind === "sql" ? "Query (SQL)" : "Query (inputs)"}
          <CopyButton text={sql} />
        </h3>
        <Code text={sql} language="sql" />
      </div>
      {query.kind === "code" ? (
        <div>
          <h3 class="eyebrow">Query (code over the inputs)</h3>
          <Code text={query.code} language="python" />
        </div>
      ) : null}
      {guarded?.guardedSql ? (
        <div>
          <h3 class="eyebrow">As run, after the Guard</h3>
          <p class="note" style={{ marginBottom: "5px" }}>
            {work.minGroupSize !== null
              ? `The Guard added a minimum group size of ${work.minGroupSize}${work.restrictedUsed.length ? ` on ${work.restrictedUsed.join(", ")}` : ""}.`
              : "The Guard rewrote the Query before it ran."}
          </p>
          <Code text={guarded.guardedSql} language="sql" />
        </div>
      ) : work.minGroupSize !== null ? (
        <p class="note">
          The Guard holds this Query to a minimum group size of{" "}
          {work.minGroupSize}
          {work.restrictedUsed.length
            ? ` on ${work.restrictedUsed.join(", ")}`
            : ""}
          .
        </p>
      ) : null}
      <dl class="facts">
        <div>
          <dt>Rows</dt>
          <dd>
            {result.rowCount.toLocaleString("en-US")}
            {result.truncated
              ? ` (first ${result.rows.length.toLocaleString("en-US")} shown)`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Query time</dt>
          <dd>{formatNumber(result.ms, 0)} ms</dd>
        </div>
        <div>
          <dt>Rulebook</dt>
          <dd>Version {view.rulebookVersion}</dd>
        </div>
        <div>
          <dt>Tolerance</dt>
          <dd>±{verification.tolerancePct}%</dd>
        </div>
        {work.tables.length ? (
          <div>
            <dt>Tables</dt>
            <dd>{work.tables.join(", ")}</dd>
          </div>
        ) : null}
        {updated !== null ? (
          <div>
            <dt>Updated</dt>
            <dd>{formatTime(updated, "hour")}</dd>
          </div>
        ) : null}
      </dl>
      {verification.status === "flagged" && verification.reasons.length ? (
        <div>
          <h3 class="eyebrow">Why it is Flagged</h3>
          <ul class="checks">
            {verification.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {verification.claims.length ? (
        <div>
          <h3 class="eyebrow">Claims, as recomputed</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <span>Claim</span>
                  </th>
                  <th scope="col" class="num">
                    <span>Stated</span>
                  </th>
                  <th scope="col" class="num">
                    <span>Recomputed</span>
                  </th>
                  <th scope="col">
                    <span>Outcome</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {verification.claims.map((claim) => (
                  <tr key={claim.id}>
                    <td style={{ whiteSpace: "normal" }}>{claim.label}</td>
                    <td class="num">{fmtClaim(claim.stated, claim)}</td>
                    <td class="num">{fmtClaim(claim.actual, claim)}</td>
                    <td class={claim.ok ? "ok" : "no"}>
                      {claim.ok ? "✓ Matches" : `⚑ ${claim.note ?? "Differs"}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {work.runs.length ? (
        <div>
          <h3 class="eyebrow">Runs</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <span>Run</span>
                  </th>
                  <th scope="col" class="num">
                    <span>Rows</span>
                  </th>
                  <th scope="col" class="num">
                    <span>ms</span>
                  </th>
                  <th scope="col">
                    <span>Outcome</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {work.runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      {run.label} ({run.kind})
                    </td>
                    <td class="num">
                      {run.rows === null
                        ? "–"
                        : run.rows.toLocaleString("en-US")}
                    </td>
                    <td class="num">{formatNumber(run.ms, 0)}</td>
                    <td
                      class={run.ok ? "ok" : "no"}
                      style={{ whiteSpace: "normal" }}
                    >
                      {run.ok ? "✓ OK" : `⚑ ${run.error ?? "Error"}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <details
        style={{ border: 0 }}
        onToggle={(event) => setRows(event.currentTarget.open)}
      >
        <summary style={{ paddingLeft: 0, paddingRight: 0 }}>
          The rows
          <span>
            {result.rows.length.toLocaleString("en-US")} ×{" "}
            {result.columns.length} columns
          </span>
        </summary>
        {rows ? <RowsTable result={result} theme={theme} /> : null}
      </details>
    </div>
  );
}

export function ViewCard({
  payload,
  host,
  theme,
  snapshot = false,
}: {
  payload: ViewPayload;
  host: CardHost | null;
  theme: Theme;
  snapshot?: boolean;
}) {
  const [shown, setShown] = useState(payload);
  const [values, setValues] = useState<ParamValues>(payload.view.params);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const sequence = useMemo(createSequence, []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiting = useRef(false);
  const latest = useRef(values);
  const current = useRef(shown);
  const slotMemo = useRef<{ id: string; slots: Record<string, number> }>({
    id: payload.view.id,
    slots: {},
  });
  const first = useRef({ id: payload.view.id, revision: payload.view.revision });
  const plot = useRef<HTMLDivElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const [measure, width] = useWidth();

  const apply = (next: ViewPayload, keepValues = false) => {
    current.current = next;
    setShown(next);
    if (!keepValues) {
      latest.current = next.view.params;
      setValues(next.view.params);
    }
  };

  // The Host may send the same View again (a Link, a Refresh): the latest revision wins.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only when the Host hands over a payload.
  useEffect(() => {
    if (payload === current.current) return;
    if (supersedes(current.current.view, payload.view))
      apply(payload, waiting.current);
  }, [payload]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const view = shown.view;
  const { spec } = view;
  if (first.current.id !== view.id)
    first.current = { id: view.id, revision: view.revision };
  if (slotMemo.current.id !== view.id)
    slotMemo.current = { id: view.id, slots: {} };
  const draw = first.current.revision === view.revision;

  // Rows that changed after a Control cross-fade in; nothing else moves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the fade follows the revision.
  useEffect(() => {
    if (draw || !plot.current?.animate) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    plot.current.animate([{ opacity: 0.35 }, { opacity: 1 }], {
      duration: 150,
      easing: "ease-out",
    });
  }, [view.revision, view.id]);

  const canRun = !!host?.canRun && !snapshot;
  const fail = (message: string) => {
    setError(message);
    latest.current = current.current.view.params;
    setValues(latest.current);
  };
  const fire = (params: ParamValues) => {
    if (!host) return;
    const turn = sequence.next();
    setLoading(true);
    const done = () => {
      if (!sequence.isLatest(turn)) return false;
      waiting.current = false;
      setLoading(false);
      return true;
    };
    host.run(current.current.view.id, params).then(
      (result) => {
        if (!done()) return;
        const read = readToolResult(result);
        if (read && "payload" in read) {
          setError(null);
          apply(read.payload);
          host.tell(modelContextText(read.payload.view, read.payload.view.params));
        } else fail(read?.error ?? "The Host answered without a View.");
      },
      (reason: unknown) => {
        if (!done()) return;
        fail(reason instanceof Error ? reason.message : "The Query could not be run.");
      },
    );
  };
  const act: Act = {
    values,
    defaults: useMemo(() => specParams(spec), [spec]),
    enabled: canRun,
    set: (changes) => {
      if (!canRun) return;
      const next = { ...latest.current, ...changes };
      latest.current = next;
      waiting.current = true;
      setValues(next);
      setError(null);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fire(next), DEBOUNCE_MS);
    },
  };

  const slots = (names: string[]) => {
    slotMemo.current.slots = {
      ...slotMemo.current.slots,
      ...assignSlots(names, slotMemo.current.slots),
    };
    return slotMemo.current.slots;
  };

  const missing = missingFields(view.result, encodingFields(spec.encoding));
  const Chart = CHARTS[spec.encoding.kind];
  const blocking = view.findings.filter((finding) => finding.message);
  const showWork = () => {
    setOpen(true);
    if (details.current) details.current.open = true;
    details.current?.scrollIntoView?.({ block: "nearest" });
  };

  return (
    <article
      class={loading ? "card loading" : "card"}
      aria-busy={loading}
      aria-label={spec.title}
    >
      {loading ? <div class="progress" role="progressbar" aria-label="Running the Query" /> : null}
      <header class="head">
        <div>
          <p class="eyebrow">{eyebrowOf(view)}</p>
          <h1 class="title">{spec.title}</h1>
          {spec.subtitle ? <p class="subtitle">{spec.subtitle}</p> : null}
        </div>
        <Stamp view={view} onOpen={showWork} />
      </header>
      <Controls spec={spec} act={act} error={error} snapshot={snapshot} />
      <section>
        <div class={draw ? "plot draw" : "plot"} ref={plot}>
          <div ref={measure}>
            {missing.length ? (
              <Empty>
                The result has no column{missing.length > 1 ? "s" : ""}{" "}
                {missing.map((field) => `"${field}"`).join(", ")}, so this View
                cannot be drawn. Its rows are in Show the work.
              </Empty>
            ) : width === 0 ? (
              <div style={{ minHeight: "120px" }} />
            ) : Chart ? (
              <Chart
                view={view}
                encoding={spec.encoding}
                width={width}
                theme={theme}
                slots={slots}
                act={act}
                regions={shown.regions}
              />
            ) : (
              <RowsTable result={view.result} theme={theme} />
            )}
          </div>
        </div>
        {view.result.truncated ? (
          <p class="note" style={{ marginTop: "8px" }}>
            Showing the first {view.result.rows.length.toLocaleString("en-US")}{" "}
            of {view.result.rowCount.toLocaleString("en-US")} rows.
          </p>
        ) : null}
      </section>
      <Finding view={view} />
      {blocking.length ? (
        <section>
          <h2 class="eyebrow" style={{ marginBottom: "4px" }}>
            Check findings
          </h2>
          <ul class="checks">
            {blocking.map((finding) => (
              <li key={`${finding.rule}:${finding.message}`}>
                <code>{finding.rule}</code> {finding.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <details
        ref={details}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          Show the work
          <span>
            {view.work.runs.length} {view.work.runs.length === 1 ? "Run" : "Runs"} ·
            Rulebook v{view.rulebookVersion}
          </span>
        </summary>
        {open ? <Work view={view} theme={theme} /> : null}
      </details>
      {snapshot ? (
        <p class="snapshot">
          Snapshot ·{" "}
          {parseTime(view.updatedAt) !== null
            ? `${formatTime(parseTime(view.updatedAt) ?? 0, "hour")} UTC`
            : view.updatedAt}
        </p>
      ) : null}
    </article>
  );
}
