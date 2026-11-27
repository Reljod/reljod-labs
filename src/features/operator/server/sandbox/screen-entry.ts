/*
 * The process inside a Run's Screen sandbox. Bundled with esbuild into
 * `screen-bundle.generated.ts` (`pnpm build:operator-screen`) and written
 * into the sandbox when the Run starts; never imported by the app.
 *
 * Three things in one Node process, all on loopback (the sandbox has no
 * network):
 *  - HARBOURMASTER as a small web app on :4310: one page that shows the
 *    80x24 terminal and sends every key and click back to this server.
 *  - The Guard in front of it: each input is run on a copy of the machine
 *    first, and applied only if the Rules allow what it would change.
 *  - The driver on :4311, for the harness only: it moves the mouse and
 *    presses keys in a headless Chromium showing that page, and answers with
 *    a picture of the Screen.
 * The model never talks to either port. It gets pictures and sends Actions.
 */
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { ScreenAction } from "../../domain/actions";
import { domKeyToInput } from "../../legacy/input";
import { cellAt, TERMINAL_CSS } from "../../legacy/terminal";
import { GEOMETRY, type LegacyInput } from "../../legacy/types";
import {
  type ActRequest,
  type ActResult,
  SCREEN_DIR,
  SCREEN_PORTS,
  type ScreenConfig,
  SECRET_HEADER,
} from "./protocol";
import { createScreenCore } from "./screen-core";

// playwright-core is installed in the sandbox image, not bundled.
type Page = {
  goto(url: string): Promise<unknown>;
  screenshot(options: { type: "png" }): Promise<Buffer>;
  waitForFunction(expression: string): Promise<unknown>;
  mouse: {
    click(x: number, y: number): Promise<void>;
    move(x: number, y: number): Promise<void>;
    wheel(dx: number, dy: number): Promise<void>;
  };
  keyboard: {
    press(key: string): Promise<void>;
    type(text: string): Promise<void>;
  };
};
type Browser = {
  newPage(options: {
    viewport: { width: number; height: number };
  }): Promise<Page>;
};
declare const require: (name: string) => {
  chromium: { launch(options?: { args?: string[] }): Promise<Browser> };
};

const config = JSON.parse(
  readFileSync(`${SCREEN_DIR}/config.json`, "utf8"),
) as ScreenConfig;

// The machine and the Guard in front of it (screen-core.ts) ------------------------------

const core = createScreenCore(config, Date.now);

// HARBOURMASTER, the web app ------------------------------------------------------------

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>HARBOURMASTER</title>
<style>html,body{margin:0;background:#000;overflow:hidden}${TERMINAL_CSS}</style></head>
<body><div class="hm-term" id="t"></div>
<script>
(function () {
  var term = document.getElementById("t");
  var queue = [];
  var busy = false;
  window.__busy = 0;
  function pump() {
    if (busy) return;
    var next = queue.shift();
    if (!next) { window.__busy = 0; return; }
    busy = true;
    fetch("/input", { method: "POST", body: JSON.stringify(next) })
      .then(function (r) { return r.text(); })
      .then(function (html) { term.innerHTML = html; })
      .catch(function () {})
      .then(function () { busy = false; window.__busy = queue.length; pump(); });
  }
  function send(input) { queue.push(input); window.__busy = queue.length + 1; pump(); }
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    send({ key: e.key, shift: e.shiftKey });
  });
  term.addEventListener("mousedown", function (e) {
    var box = term.getBoundingClientRect();
    send({ x: Math.round(e.clientX - box.left), y: Math.round(e.clientY - box.top) });
  });
  var lastWheel = 0;
  document.addEventListener("wheel", function (e) {
    var now = Date.now();
    if (now - lastWheel < 150 || e.deltaY === 0) return;
    lastWheel = now;
    send({ key: e.deltaY > 0 ? "PageDown" : "PageUp", shift: false });
  });
  send({ refresh: true });
})();
</script></body></html>`;

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
    if (chunks.length > 64) break;
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** What the page sent, as an input of the machine; null when it is not one. */
function inputFrom(sent: unknown): LegacyInput | null {
  if (typeof sent !== "object" || sent === null) return null;
  const message = sent as Record<string, unknown>;
  if (typeof message.key === "string")
    return domKeyToInput(message.key, message.shift === true);
  if (typeof message.x === "number" && typeof message.y === "number") {
    const cell = cellAt(message.x, message.y);
    return cell ? { kind: "click", row: cell.row, col: cell.col } : null;
  }
  return null;
}

createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/input") {
    try {
      const input = inputFrom(JSON.parse(await body(request)));
      if (input) core.take(input);
    } catch {
      // Not an input: the Screen is sent back unchanged.
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(core.html());
    return;
  }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(PAGE);
}).listen(SCREEN_PORTS.legacy, "127.0.0.1");

// The driver: the harness's hands and eyes ------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { chromium } = require("playwright-core");
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  const page = await browser.newPage({
    viewport: { width: GEOMETRY.width, height: GEOMETRY.height },
  });
  await page.goto(`http://127.0.0.1:${SCREEN_PORTS.legacy}/`);
  const settle = () => page.waitForFunction("window.__busy === 0");
  await settle();

  let pointer: { x: number; y: number } | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  /** The atomic steps of an Action, each sent as a real key or mouse event. */
  function unitsOf(action: ScreenAction): (() => Promise<unknown>)[] {
    switch (action.type) {
      case "click":
        return [
          async () => {
            pointer = { x: action.x, y: action.y };
            await page.mouse.click(action.x, action.y);
          },
        ];
      case "type":
        return [...action.text].map((char) => () => page.keyboard.type(char));
      case "key":
        return action.keys.map((key) => () => page.keyboard.press(key));
      case "scroll":
        return [
          async () => {
            await page.mouse.move(GEOMETRY.width / 2, GEOMETRY.height / 2);
            await page.mouse.wheel(0, action.dy);
            await sleep(60);
          },
        ];
      case "wait":
        return [() => sleep(action.ms)];
    }
  }

  async function act(request: ActRequest): Promise<ActResult> {
    const started = Date.now();
    core.beginAction();
    try {
      const units = request.action ? unitsOf(request.action) : [];
      for (const unit of units.slice(Math.max(0, request.skip ?? 0))) {
        await unit();
        await settle();
        if (core.blocked()) break;
      }
      // Draw the Screen as it is now (the clock, a timeout) before the picture.
      await page.keyboard.press("F24").catch(() => {});
      await settle();
      const png = await page.screenshot({ type: "png" });
      return {
        png: png.toString("base64"),
        ...core.endAction(pointer, started),
      };
    } finally {
      core.abortAction();
    }
  }

  const expected = Buffer.from(config.secret);
  /** The harness's secret, compared in constant time. */
  const sameSecret = (given: string | string[] | undefined) => {
    if (typeof given !== "string") return false;
    const offered = Buffer.from(given);
    return (
      offered.length === expected.length && timingSafeEqual(offered, expected)
    );
  };

  createServer(async (request, response) => {
    const send = (status: number, value: unknown) => {
      response.statusCode = status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(value));
    };
    if (!sameSecret(request.headers[SECRET_HEADER]))
      return send(403, { error: "forbidden" });
    try {
      if (request.url === "/health") return send(200, { ok: true });
      if (request.url === "/books") return send(200, core.report());
      const sent = request.method === "POST" ? await body(request) : "";
      const payload = sent ? JSON.parse(sent) : {};
      if (request.url === "/approve") {
        // A person approved exactly this change; it is good for one commit.
        if (typeof payload.fingerprint === "string")
          core.approve(payload.fingerprint);
        else core.touch();
        return send(200, { ok: true });
      }
      if (request.url === "/touch") {
        core.touch();
        return send(200, { ok: true });
      }
      if (request.url === "/act") {
        // One Action at a time, in the order asked.
        const result = chain.then(() => act(payload as ActRequest));
        chain = result.catch(() => {});
        return send(200, await result);
      }
      return send(404, { error: "not found" });
    } catch (error) {
      return send(500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }).listen(SCREEN_PORTS.control, "127.0.0.1", () => {
    console.log("operator-screen ready");
  });
}

main().catch((error) => {
  console.error("operator-screen failed", error);
  process.exit(1);
});
