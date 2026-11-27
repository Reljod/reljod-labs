import "server-only";
import { Sandbox } from "@vercel/sandbox";
import type { Actor } from "../core/actor";
import { runRead } from "../core/engine";
import { LIMITS } from "../domain/limits";
import type {
  AccountDetail,
  CustomerDetail,
  LoanDetail,
  RulesView,
} from "../domain/views";
import { sql } from "./db";
import { env } from "./env";

/*
 * The Teller's coding Sandbox (ADR 0022's pattern): Vercel Sandbox with no
 * network, one per chat Session, named after it. The harness writes the
 * data: the customer's file as the reads return it (the same Owner scope
 * and Role check as any read), never a credential, a token or a card
 * number. Code is analysis; it cannot reach the bank.
 */
export const SANDBOX_LIMITS = {
  commandMs: 45_000,
  sandboxMs: 10 * 60_000,
  outputChars: 6_000,
  outputBytes: 24_000,
  outputFileBlocks: 20_000,
};

const ROOT = "/vercel/sandbox";
const NODE_SECONDS = Math.floor(SANDBOX_LIMITS.commandMs / 1000) - 2;

/** Runs `node $1` with capped output files, prints at most `outputBytes` of each, exits with node's code. */
const RUNNER = [
  `ulimit -f ${SANDBOX_LIMITS.outputFileBlocks} 2>/dev/null`,
  `cd ${ROOT}`,
  'out="$1.out"; err="$1.err"',
  `if command -v timeout >/dev/null 2>&1; then timeout -k 2 ${NODE_SECONDS} node "$1" >"$out" 2>"$err"; else node "$1" >"$out" 2>"$err"; fi`,
  "code=$?",
  `cap() { size=$(wc -c <"$1"); head -c ${SANDBOX_LIMITS.outputBytes} "$1"; if [ "$size" -gt ${SANDBOX_LIMITS.outputBytes} ]; then printf '\\n… [%s more bytes cut]' $((size - ${SANDBOX_LIMITS.outputBytes})); fi; }`,
  'cap "$out"; cap "$err" >&2',
  `[ "$code" = 124 ] && printf '\\nTimed out after ${NODE_SECONDS} s.' >&2`,
  'rm -f "$out" "$err"',
  'exit "$code"',
].join("\n");

export type Chart = {
  type: "bar" | "line";
  title: string;
  unit?: string;
  labels: string[];
  series: { name: string; values: number[] }[];
};

export type CodeResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
  chart: Chart | null;
  files: string[];
};

const cap = (text: string) =>
  text.length > SANDBOX_LIMITS.outputChars
    ? `${text.slice(0, SANDBOX_LIMITS.outputChars)}\n… [${text.length - SANDBOX_LIMITS.outputChars} more characters cut]`
    : text;

/** The `CHART:` line of a script's output, if it printed a well-formed one. */
export function chartOf(stdout: string): Chart | null {
  const line = stdout.split("\n").find((item) => item.startsWith("CHART:"));
  if (!line) return null;
  try {
    const chart = JSON.parse(line.slice(6)) as Chart;
    if (
      !["bar", "line"].includes(chart.type) ||
      !Array.isArray(chart.labels) ||
      !Array.isArray(chart.series)
    )
      return null;
    const labels = chart.labels
      .slice(0, 36)
      .map((label) => String(label).slice(0, 24));
    const series = chart.series.slice(0, 4).map((item) => ({
      name: String(item.name).slice(0, 40),
      values: labels.map((_, index) => {
        const value = Number(item.values?.[index]);
        return Number.isFinite(value) ? value : 0;
      }),
    }));
    return {
      type: chart.type,
      title: String(chart.title ?? "").slice(0, 80),
      unit: chart.unit ? String(chart.unit).slice(0, 8) : undefined,
      labels,
      series,
    };
  } catch {
    return null;
  }
}

/** The files the harness hands the Sandbox for one customer: what the reads return, nothing more. */
export async function customerFiles(
  actor: Actor,
  customerId: string,
): Promise<{ path: string; content: string }[]> {
  const db = sql();
  const detail = (await runRead(db, actor, "get_customer", {
    customerId,
  })) as CustomerDetail;
  const files: { path: string; content: string }[] = [];
  let bytes = 0;
  const add = (path: string, value: unknown) => {
    const content = JSON.stringify(value);
    if (bytes + content.length > LIMITS.sandboxDataBytes) return;
    bytes += content.length;
    files.push({ path: `${ROOT}/data/${path}`, content });
  };
  // Card tokens are never read by any view; cards here carry lastFour only.
  add("customer.json", detail);
  for (const account of detail.accounts) {
    const pages: AccountDetail["transactions"] = [];
    let beforeId: number | undefined;
    for (let page = 0; page < 8; page += 1) {
      const { transactions } = (await runRead(db, actor, "list_transactions", {
        accountId: account.id,
        limit: 50,
        beforeId,
      })) as { transactions: AccountDetail["transactions"] };
      pages.push(...transactions);
      if (transactions.length < 50) break;
      beforeId = transactions.at(-1)?.id;
    }
    add(`transactions/${account.number}.json`, pages);
  }
  for (const loan of detail.loans) {
    add(
      `loans/${loan.number}.json`,
      (await runRead(db, actor, "get_loan", { loanId: loan.id })) as LoanDetail,
    );
  }
  add(
    "rules.json",
    ((await runRead(db, actor, "list_rules", {})) as RulesView).rules.map(
      (rule) => ({
        id: rule.id,
        sentence: rule.sentence,
        params: rule.params,
        enabled: rule.enabled,
      }),
    ),
  );
  return files;
}

export const sandboxName = (sessionId: string) => `bank-session-${sessionId}`;

/**
 * Runs the Teller's code in the Session's Sandbox with the data written
 * first. Never throws: every failure comes back as a result with a non-zero
 * exit code and the reason in stderr.
 */
export async function runCode(input: {
  sessionId: string;
  callId: string;
  code: string;
  files: { path: string; content: string }[];
}): Promise<CodeResult> {
  const started = Date.now();
  const failed = (stderr: string): CodeResult => ({
    stdout: "",
    stderr,
    exitCode: 1,
    ms: Date.now() - started,
    chart: null,
    files: input.files.map((file) => file.path.replace(`${ROOT}/`, "")),
  });
  if (!env.sandboxConfigured()) {
    return failed(
      "Sandbox unavailable: this server has no Vercel Sandbox credentials.",
    );
  }
  try {
    const sandbox = await Sandbox.getOrCreate({
      name: sandboxName(input.sessionId),
      networkPolicy: "deny-all",
      timeout: SANDBOX_LIMITS.sandboxMs,
      // Not persistent: the data is written again before every run, so no
      // disk has to be resumed. A persistent Sandbox snapshots its whole
      // disk on every stop and keeps it for 30 days, which fills the quota.
      persistent: false,
    });
    // getOrCreate may hand back a Sandbox made with other settings: enforce them.
    await sandbox.update({ networkPolicy: "deny-all", persistent: false });
    const file = `${ROOT}/run-${input.callId.replace(/[^\w-]/g, "_").slice(0, 60)}.mjs`;
    await sandbox.writeFiles([
      ...input.files,
      { path: file, content: input.code },
    ]);
    const result = await sandbox.runCommand(
      "sh",
      ["-c", RUNNER, "bank", file],
      {
        timeoutMs: SANDBOX_LIMITS.commandMs + 5_000,
      },
    );
    const [stdout, stderr] = await Promise.all([
      result.stdout(),
      result.stderr(),
    ]);
    return {
      stdout: cap(stdout),
      stderr: cap(stderr),
      exitCode: result.exitCode,
      ms: Date.now() - started,
      chart: chartOf(stdout),
      files: input.files.map((item) => item.path.replace(`${ROOT}/`, "")),
    };
  } catch (error) {
    // The model and the page get the redacted reason; the log keeps the cause.
    console.error("[bank] sandbox run", error);
    return failed(`The Sandbox could not run the code: ${sdkReason(error)}`);
  }
}

const REASON_CHARS = 160;

/**
 * Why the SDK failed, safe to show the model and the page: the HTTP status
 * and Vercel's error code and message, or a stream error's code. Anything
 * token-shaped is cut, so a credential can never ride along. Unknown errors
 * give only their name. (A copy of Harness's `sdkReason`: features do not
 * import each other.)
 */
export function sdkReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const e = error as Error & {
    response?: { status?: number };
    json?: { error?: { code?: unknown; message?: unknown } };
    code?: unknown;
  };
  const parts: string[] = [];
  if (typeof e.response?.status === "number")
    parts.push(`HTTP ${e.response.status}`);
  const code = e.json?.error?.code ?? e.code;
  if (typeof code === "string" && code) parts.push(code);
  const text =
    typeof e.json?.error?.message === "string"
      ? e.json.error.message
      : parts.length > 0 || e.name === "StreamError"
        ? e.message
        : "";
  const head = parts.length > 0 ? parts.join(" ") : e.name || "Error";
  const said = text
    .replace(/Bearer\s+\S+/gi, "[hidden]")
    .replace(/[A-Za-z0-9_\-.]{32,}/g, "[hidden]")
    .replace(/\s+/g, " ")
    .trim();
  const reason = said ? `${head}: ${said}` : head;
  return reason.length > REASON_CHARS
    ? `${reason.slice(0, REASON_CHARS)}…`
    : reason;
}

/** Stops and deletes a Session's Sandbox, if it has one. Best effort. */
export async function disposeSandbox(sessionId: string) {
  try {
    const sandbox = await Sandbox.get({ name: sandboxName(sessionId) });
    await sandbox.stop().catch(() => {});
    // With its snapshots: `delete()` alone would leave them behind.
    await sandbox.delete({ deleteOrphanSnapshots: true });
  } catch {
    // None was made, or it is already gone.
  }
}
