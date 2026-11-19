/**
 * Scores the real Examiner against the Manifest, through a running app's MCP
 * server: starts an Examination per Sample, waits for it, and prints the
 * Verdict, the Score and the cost. It spends money (about five cents a
 * Document) and starts Sandboxes: run it only when asked.
 *
 *   pnpm eval:loupe <token> [sampleId ...] [--base=http://localhost:3113] [--mode=examiner|sweep]
 *
 * `<token>` is a Loupe MCP token minted on the page under Connect. Without
 * sample ids it runs three: a genuine image, a tampered image and a
 * tampered PDF.
 */
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const base = flag("base", "http://localhost:3113");
const mode = flag("mode", "examiner");
const [token, ...given] = args.filter((arg) => !arg.startsWith("--"));
if (!token) {
  console.error("Usage: pnpm eval:loupe <token> [sampleId ...]");
  process.exit(1);
}
const samples = given.length
  ? given
  : ["lp-va-invoice-01", "lp-te-idcard-01-t1", "lp-te-payslip-01-t2"];

type ToolResult = {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
};

async function tool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const response = await fetch(`${base}/api/loupe/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: input },
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name}: ${response.status} ${text}`);
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  return (JSON.parse(data ?? text) as { result: ToolResult }).result;
}

type Row = {
  sample: string;
  truth: string;
  verdict: string;
  correct: boolean;
  caught: string;
  falseFindings: number;
  usd: number;
  seconds: number;
  gate: string;
};
const rows: Row[] = [];

for (const sampleId of samples) {
  const started = await tool("start_examination", { sampleId, mode });
  if (started.isError) {
    console.error(sampleId, started.content[0]?.text);
    continue;
  }
  const examinationId = started.structuredContent?.examinationId as string;
  const began = Date.now();
  let detail: Record<string, unknown> = {};
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    detail = (await tool("get_examination", { examinationId }))
      .structuredContent as Record<string, unknown>;
    if (detail.status !== "running" && detail.status !== "queued") break;
    if (Date.now() - began > 8 * 60_000) break;
  }
  const score = detail.score as {
    truth: string;
    correct: boolean;
    caught: number;
    tampers: number;
    falseFindings: number;
  } | null;
  rows.push({
    sample: sampleId,
    truth: score?.truth ?? "?",
    verdict: String(detail.verdict ?? detail.status),
    correct: score?.correct ?? false,
    caught: score ? `${score.caught}/${score.tampers}` : "?",
    falseFindings: score?.falseFindings ?? 0,
    usd: Number(detail.costUsd ?? 0),
    seconds: Math.round((Date.now() - began) / 1000),
    gate: detail.gatePassed
      ? "passed"
      : String(detail.stoppedBy ?? detail.status),
  });
  console.log(JSON.stringify(rows.at(-1)));
}

console.table(rows);
const tampered = rows.filter((row) => row.truth === "tampered");
const genuine = rows.filter((row) => row.truth === "genuine");
console.log(
  `Detected ${tampered.filter((row) => row.correct).length}/${tampered.length} tampered; flagged ${genuine.filter((row) => !row.correct).length}/${genuine.length} genuine; $${rows.reduce((sum, row) => sum + row.usd, 0).toFixed(3)} in all.`,
);
