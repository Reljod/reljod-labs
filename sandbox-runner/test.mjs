// node --test sandbox-runner/
// The unit tests need nothing. The integration tests need a working `docker`
// and are skipped without one. They start their own Runners on random ports
// under their own instance names, so they never touch a Runner already on the host.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_TTL_SECONDS, sign, verify } from "./token.mjs";
import {
  containerName,
  isSessionId,
  LIMITS,
  normalizeCommand,
  normalizePath,
  normalizeTimeout,
} from "./validate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECRET = "test-secret-test-secret-test-secret-0123";
const nowSeconds = () => Math.floor(Date.now() / 1000);

// ------------------------------------------------------------------ helpers

/** Start a Runner as a child process on a random port. */
async function startRunner(extraEnv = {}) {
  const proc = spawn(process.execPath, [path.join(HERE, "runner.mjs")], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      RUNNER_SECRET: SECRET,
      RUNNER_PORT: "0",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const runner = { proc, output: "", base: "", host: "", exited: null };
  runner.exited = new Promise((resolve) =>
    proc.on("exit", (code, signal) => resolve({ code, signal })),
  );
  const listening = new Promise((resolve, reject) => {
    proc.stdout.on("data", (chunk) => {
      runner.output += chunk;
      const match = /"event":"listening","host":"([^"]+)","port":(\d+)/.exec(
        runner.output,
      );
      if (match) resolve({ host: match[1], port: Number(match[2]) });
    });
    proc.stderr.on("data", (chunk) => {
      runner.output += chunk;
    });
    proc.on("exit", () =>
      reject(new Error(`the Runner exited before listening: ${runner.output}`)),
    );
  });
  const { host, port } = await listening;
  runner.host = host;
  runner.base = `http://${host}:${port}`;
  runner.stop = async (signal = "SIGTERM") => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill(signal);
    return runner.exited;
  };
  return runner;
}

/** A client for one Session, signing a fresh token per call like the app does. */
function session(runner, sid = randomUUID()) {
  const call = async (method, route, act, body, token) => {
    const headers = {};
    const bearer =
      token === undefined
        ? sign({ sid, exp: nowSeconds() + 60, act }, SECRET)
        : token;
    if (bearer !== null) headers.authorization = `Bearer ${bearer}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(runner.base + route, {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return {
      status: response.status,
      body: json,
      text,
      headers: response.headers,
    };
  };
  return {
    sid,
    name: `harness-sbx-${sid}`,
    call,
    write: (filePath, content) =>
      call("POST", `/sessions/${sid}/files`, "write", {
        path: filePath,
        content,
      }),
    read: (filePath) =>
      call(
        "GET",
        `/sessions/${sid}/files?path=${encodeURIComponent(filePath)}`,
        "read",
      ),
    list: () => call("GET", `/sessions/${sid}/files`, "list"),
    run: (command, timeoutMs) =>
      call("POST", `/sessions/${sid}/run`, "run", { command, timeoutMs }),
    destroy: () => call("DELETE", `/sessions/${sid}`, "destroy"),
  };
}

function dockerSync(args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 30_000,
  });
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const containersOf = (instance) =>
  dockerSync([
    "ps",
    "-a",
    "--filter",
    "label=harness.sandbox=1",
    "--filter",
    `label=harness.runner=${instance}`,
    "--format",
    "{{.Names}}",
  ])
    .stdout.split("\n")
    .filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------ token

describe("token", () => {
  const sid = "0b9e1c1a-7d0e-4f0a-9a57-3f1f6f2f8f10";
  const now = 1_800_000_000;
  const good = sign({ sid, exp: now + 60, act: "run" }, SECRET);

  test("the README test vector", () => {
    const token = sign(
      {
        sid: "123e4567-e89b-42d3-a456-426614174000",
        exp: 1800000000,
        act: "run",
      },
      "0123456789abcdef0123456789abcdef",
    );
    assert.equal(
      token,
      "eyJzaWQiOiIxMjNlNDU2Ny1lODliLTQyZDMtYTQ1Ni00MjY2MTQxNzQwMDAiLCJleHAiOjE4MDAwMDAwMDAsImFjdCI6InJ1biJ9.x4d1b-3_LfP2u9e6oBe0EiThcaQkgAljs49d_G9LxTU",
    );
  });

  test("a good token verifies", () => {
    const result = verify(good, SECRET, { sid, act: "run", now });
    assert.deepEqual(result, {
      ok: true,
      payload: { sid, exp: now + 60, act: "run" },
    });
  });

  test("a tampered payload or signature is refused", () => {
    const [body, mac] = good.split(".");
    const forged = Buffer.from(
      JSON.stringify({ sid, exp: now + 60, act: "destroy" }),
    ).toString("base64url");
    assert.equal(
      verify(`${forged}.${mac}`, SECRET, { sid, act: "destroy", now }).reason,
      "bad_signature",
    );
    const flipped = (mac[0] === "A" ? "B" : "A") + mac.slice(1);
    assert.equal(
      verify(`${body}.${flipped}`, SECRET, { sid, act: "run", now }).reason,
      "bad_signature",
    );
    assert.equal(
      verify(`${body}.${mac.slice(0, 20)}`, SECRET, { sid, act: "run", now })
        .reason,
      "bad_signature",
    );
    assert.equal(
      verify(good, `${SECRET}x`, { sid, act: "run", now }).reason,
      "bad_signature",
    );
  });

  test("an expired token is refused, and one that expires too far ahead", () => {
    assert.equal(
      verify(good, SECRET, { sid, act: "run", now: now + 60 }).reason,
      "expired",
    );
    assert.equal(
      verify(good, SECRET, { sid, act: "run", now: now + 59 }).ok,
      true,
    );
    const far = sign(
      { sid, exp: now + MAX_TTL_SECONDS + 1, act: "run" },
      SECRET,
    );
    assert.equal(
      verify(far, SECRET, { sid, act: "run", now }).reason,
      "too_far_ahead",
    );
    const edge = sign({ sid, exp: now + MAX_TTL_SECONDS, act: "run" }, SECRET);
    assert.equal(verify(edge, SECRET, { sid, act: "run", now }).ok, true);
  });

  test("a token for another session or another action is refused", () => {
    const other = "5f0c2a52-1a43-4a8e-8a53-0d4f7b1c9e77";
    assert.equal(
      verify(good, SECRET, { sid: other, act: "run", now }).reason,
      "wrong_session",
    );
    assert.equal(
      verify(good, SECRET, { sid, act: "write", now }).reason,
      "wrong_action",
    );
  });

  test("anything that is not a token is malformed", () => {
    const signedRaw = (text) => {
      const body = Buffer.from(text, "utf8");
      const mac = createHmac("sha256", SECRET).update(body).digest();
      return `${body.toString("base64url")}.${mac.toString("base64url")}`;
    };
    for (const bad of [
      undefined,
      null,
      42,
      "",
      "abc",
      "a.b.c",
      "a b.c",
      `${good}=`,
      "x".repeat(2000),
    ]) {
      assert.equal(
        verify(bad, SECRET, { sid, act: "run", now }).ok,
        false,
        String(bad).slice(0, 20),
      );
    }
    assert.equal(
      verify("abc", SECRET, { sid, act: "run", now }).reason,
      "malformed",
    );
    // Correctly signed, but not the payload shape.
    assert.equal(
      verify(
        signedRaw(JSON.stringify({ sid, exp: now + 60, act: "run" })),
        SECRET,
        { sid, act: "run", now },
      ).ok,
      true,
    );
    for (const raw of [
      JSON.stringify({ sid, exp: String(now + 60), act: "run" }),
      JSON.stringify({ sid, exp: now + 60.5, act: "run" }),
      JSON.stringify({ sid, act: "run" }),
      JSON.stringify({ exp: now + 60, act: "run" }),
      JSON.stringify([sid, now + 60, "run"]),
      "null",
      "not json",
    ]) {
      assert.equal(
        verify(signedRaw(raw), SECRET, { sid, act: "run", now }).reason,
        "malformed",
        raw,
      );
    }
  });
});

// ------------------------------------------------------------------ validation

describe("validation", () => {
  test("session ids are strict lower-case UUIDs", () => {
    assert.equal(isSessionId("0b9e1c1a-7d0e-4f0a-9a57-3f1f6f2f8f10"), true);
    for (const bad of [
      "0B9E1C1A-7D0E-4F0A-9A57-3F1F6F2F8F10",
      "0b9e1c1a7d0e4f0a9a573f1f6f2f8f10",
      "0b9e1c1a-7d0e-4f0a-9a57-3f1f6f2f8f10 ",
      "0b9e1c1a-7d0e-4f0a-9a57-3f1f6f2f8f10\n",
      "../0b9e1c1a-7d0e-4f0a-9a57-3f1f6f2f8f1",
      "0b9e1c1a-7d0e-0f0a-9a57-3f1f6f2f8f10",
      "",
      null,
      "--privileged",
    ]) {
      assert.equal(isSessionId(bad), false, String(bad));
    }
    assert.equal(
      containerName("0b9e1c1a-7d0e-4f0a-9a57-3f1f6f2f8f10"),
      "harness-sbx-0b9e1c1a-7d0e-4f0a-9a57-3f1f6f2f8f10",
    );
    assert.throws(() => containerName("x; rm -rf /"));
  });

  test("paths are relative and stay in the workdir", () => {
    const ok = {
      "a.py": "a.py",
      "src/main.py": "src/main.py",
      "./a//b/./c.txt": "a/b/c.txt",
      "-rf": "-rf",
      "my file.txt": "my file.txt",
      "..a/b..": "..a/b..",
      "données.csv": "données.csv",
    };
    for (const [input, wanted] of Object.entries(ok)) {
      assert.deepEqual(normalizePath(input), { ok: true, path: wanted }, input);
    }
    for (const bad of [
      "",
      ".",
      "./",
      "/etc/passwd",
      "//etc/passwd",
      "..",
      "../x",
      "a/../../x",
      "a/..",
      "a/../b",
      "dir/",
      "a\u0000b",
      "a\nb",
      "a\tb",
      "a\\b",
      "x".repeat(201),
      "é".repeat(101),
      42,
      null,
      undefined,
      ["a"],
      { path: "a" },
    ]) {
      assert.equal(
        normalizePath(bad).ok,
        false,
        JSON.stringify(bad)?.slice(0, 30),
      );
    }
    assert.equal(normalizePath("x".repeat(200)).ok, true);
  });

  test("commands are an argv array or a string for sh -lc", () => {
    assert.deepEqual(normalizeCommand(["python3", "a.py"]), {
      ok: true,
      argv: ["python3", "a.py"],
    });
    assert.deepEqual(normalizeCommand("echo hi | wc -c"), {
      ok: true,
      argv: ["sh", "-lc", "echo hi | wc -c"],
    });
    for (const bad of [
      undefined,
      null,
      1,
      {},
      [],
      [""],
      ["a", 1],
      "",
      "   ",
      "a\u0000b",
      ["a\u0000"],
      new Array(65).fill("a"),
      "x".repeat(70_000),
      ["x".repeat(70_000)],
    ]) {
      assert.equal(
        normalizeCommand(bad).ok,
        false,
        JSON.stringify(bad)?.slice(0, 30),
      );
    }
  });

  test("the timeout defaults to its 60 s maximum", () => {
    assert.deepEqual(normalizeTimeout(undefined), {
      ok: true,
      timeoutMs: 60_000,
    });
    assert.deepEqual(normalizeTimeout(1500), { ok: true, timeoutMs: 1500 });
    for (const bad of [
      0,
      99,
      60_001,
      1.5,
      "1000",
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      assert.equal(normalizeTimeout(bad).ok, false, String(bad));
    }
  });
});

// ------------------------------------------------------------------ http, without Docker

describe("http without Docker", () => {
  let runner;
  let s;
  before(async () => {
    runner = await startRunner({
      RUNNER_DOCKER_BIN: "/nonexistent/docker",
      RUNNER_INSTANCE: "test-nodocker",
    });
    s = session(runner);
  });
  after(async () => {
    const { code } = await runner.stop();
    assert.equal(code, 0);
  });

  test("refuses to start without a long enough secret", async () => {
    for (const secret of [undefined, "short", "x".repeat(31)]) {
      const env = { PATH: process.env.PATH, RUNNER_PORT: "0" };
      if (secret !== undefined) env.RUNNER_SECRET = secret;
      const result = spawnSync(
        process.execPath,
        [path.join(HERE, "runner.mjs")],
        { env, encoding: "utf8", timeout: 10_000 },
      );
      assert.equal(result.status, 78);
      assert.match(result.stderr, /RUNNER_SECRET/);
      assert.ok(secret === undefined || !result.stderr.includes(secret));
    }
  });

  test("listens on 127.0.0.1 and health needs no token", async () => {
    assert.equal(runner.host, "127.0.0.1");
    const response = await fetch(`${runner.base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: false,
      docker: false,
      live: 0,
      max: 6,
    });
  });

  test("401 without a token, with a forged one, with an expired one", async () => {
    const route = `/sessions/${s.sid}/files`;
    const missing = await s.call("GET", route, "list", undefined, null);
    assert.equal(missing.status, 401);
    assert.deepEqual(missing.body, {
      error: {
        code: "unauthorized",
        message: "A valid bearer token is required.",
      },
    });
    const forged = sign(
      { sid: s.sid, exp: nowSeconds() + 60, act: "list" },
      "another-secret-another-secret-another",
    );
    assert.equal(
      (await s.call("GET", route, "list", undefined, forged)).body.error.code,
      "unauthorized",
    );
    assert.equal(
      (await s.call("GET", route, "list", undefined, "not-a-token")).body.error
        .code,
      "unauthorized",
    );
    const expired = await s.call(
      "GET",
      route,
      "list",
      undefined,
      sign({ sid: s.sid, exp: nowSeconds() - 1, act: "list" }, SECRET),
    );
    assert.equal(expired.status, 401);
    assert.equal(expired.body.error.code, "token_expired");
    const far = await s.call(
      "GET",
      route,
      "list",
      undefined,
      sign({ sid: s.sid, exp: nowSeconds() + 3600, act: "list" }, SECRET),
    );
    assert.equal(far.status, 401);
    assert.equal(far.body.error.code, "token_expired");
  });

  test("403 for a token of another session or another action", async () => {
    const route = `/sessions/${s.sid}/files`;
    const otherSession = sign(
      { sid: randomUUID(), exp: nowSeconds() + 60, act: "list" },
      SECRET,
    );
    const otherAction = sign(
      { sid: s.sid, exp: nowSeconds() + 60, act: "read" },
      SECRET,
    );
    for (const token of [otherSession, otherAction]) {
      const response = await s.call("GET", route, "list", undefined, token);
      assert.equal(response.status, 403);
      assert.equal(response.body.error.code, "forbidden");
    }
    // A write token does not run, a list token does not destroy.
    const write = sign(
      { sid: s.sid, exp: nowSeconds() + 60, act: "write" },
      SECRET,
    );
    assert.equal(
      (
        await s.call(
          "POST",
          `/sessions/${s.sid}/run`,
          "run",
          { command: "id" },
          write,
        )
      ).status,
      403,
    );
    const list = sign(
      { sid: s.sid, exp: nowSeconds() + 60, act: "list" },
      SECRET,
    );
    assert.equal(
      (await s.call("DELETE", `/sessions/${s.sid}`, "destroy", undefined, list))
        .status,
      403,
    );
  });

  test("400, 404 and 405 for requests that fit no route", async () => {
    const cases = [
      ["GET", "/sessions/not-a-uuid/files", 400, "invalid_session"],
      [
        "GET",
        "/sessions/0B9E1C1A-7D0E-4F0A-9A57-3F1F6F2F8F10/files",
        400,
        "invalid_session",
      ],
      ["DELETE", "/sessions/--privileged", 400, "invalid_session"],
      ["GET", "/", 404, "not_found"],
      ["GET", `/sessions/${s.sid}/files/extra`, 404, "not_found"],
      ["GET", `/sessions/${s.sid}/../../health`, 200, undefined],
      ["PUT", `/sessions/${s.sid}/files`, 405, "method_not_allowed"],
      ["GET", `/sessions/${s.sid}/run`, 405, "method_not_allowed"],
      ["GET", `/sessions/${s.sid}`, 405, "method_not_allowed"],
      ["POST", "/health", 405, "method_not_allowed"],
    ];
    for (const [method, route, status, code] of cases) {
      const response = await s.call(method, route, "list");
      assert.equal(response.status, status, `${method} ${route}`);
      assert.equal(response.body.error?.code, code, `${method} ${route}`);
    }
  });

  test("413 for a body over the limit, declared or streamed", async () => {
    const route = `/sessions/${s.sid}/files`;
    const big = await s.call("POST", route, "write", {
      path: "a.txt",
      content: "x".repeat(LIMITS.bodyBytes + 1),
    });
    assert.equal(big.status, 413);
    assert.equal(big.body.error.code, "body_too_large");

    // No content-length: the limit is enforced while the body streams in.
    const chunk = Buffer.alloc(64 * 1024, "x");
    let sent = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (sent >= 16) controller.close();
        else controller.enqueue(chunk);
        sent += 1;
      },
    });
    const streamed = await fetch(runner.base + route, {
      method: "POST",
      duplex: "half",
      body: stream,
      headers: {
        authorization: `Bearer ${sign({ sid: s.sid, exp: nowSeconds() + 60, act: "write" }, SECRET)}`,
      },
    });
    assert.equal(streamed.status, 413);
    assert.equal((await streamed.json()).error.code, "body_too_large");

    // A body is not read at all before the token checks out.
    const unauthenticated = await s.call(
      "POST",
      route,
      "write",
      { path: "a.txt", content: "x".repeat(LIMITS.bodyBytes + 1) },
      null,
    );
    assert.equal(unauthenticated.status, 401);
  });

  test("400 for a body that is not the expected JSON, 413 for a file over 256 KB", async () => {
    const files = `/sessions/${s.sid}/files`;
    const run = `/sessions/${s.sid}/run`;
    const cases = [
      [files, "write", "{not json", 400, "invalid_json"],
      [files, "write", "[1,2]", 400, "invalid_body"],
      [files, "write", "null", 400, "invalid_body"],
      [
        files,
        "write",
        { path: "../etc/passwd", content: "x" },
        400,
        "invalid_path",
      ],
      [
        files,
        "write",
        { path: "/etc/passwd", content: "x" },
        400,
        "invalid_path",
      ],
      [files, "write", { path: "a\u0000b", content: "x" }, 400, "invalid_path"],
      [
        files,
        "write",
        { path: "x".repeat(201), content: "x" },
        400,
        "invalid_path",
      ],
      [files, "write", { content: "x" }, 400, "invalid_path"],
      [files, "write", { path: "a.txt", content: 5 }, 400, "invalid_content"],
      [files, "write", { path: "a.txt" }, 400, "invalid_content"],
      [
        files,
        "write",
        { path: "a.txt", content: "x".repeat(LIMITS.fileBytes + 1) },
        413,
        "file_too_large",
      ],
      [run, "run", {}, 400, "invalid_command"],
      [run, "run", { command: ["id", 5] }, 400, "invalid_command"],
      [
        run,
        "run",
        { command: "id", timeoutMs: 60_001 },
        400,
        "invalid_timeout",
      ],
      [run, "run", { command: "id", timeoutMs: "5" }, 400, "invalid_timeout"],
    ];
    for (const [route, act, body, status, code] of cases) {
      const response = await s.call("POST", route, act, body);
      assert.equal(response.status, status, JSON.stringify(body).slice(0, 60));
      assert.equal(
        response.body.error.code,
        code,
        JSON.stringify(body).slice(0, 60),
      );
    }
    for (const bad of ["../x", "/etc/passwd", "", "a/"]) {
      const response = await s.read(bad);
      assert.equal(response.status, 400, bad);
      assert.equal(response.body.error.code, "invalid_path");
    }
  });

  test("503 when Docker is down, and reads of a Session with no Sandbox start nothing", async () => {
    const write = await s.write("a.txt", "SECRET-FILE-CONTENT-MARKER");
    assert.equal(write.status, 503);
    assert.equal(write.body.error.code, "sandbox_unavailable");
    const run = await s.run("echo hi");
    assert.equal(run.status, 503);
    assert.deepEqual(Object.keys(run.body), ["error"]);
    assert.deepEqual((await s.list()).body, { files: [], truncated: false });
    assert.equal((await s.read("a.txt")).body.error.code, "file_not_found");
    assert.deepEqual((await s.destroy()).body, { destroyed: false });
  });

  test("errors carry no stack or host path, and the log carries no token, body or content", async () => {
    const token = sign(
      { sid: s.sid, exp: nowSeconds() + 60, act: "write" },
      SECRET,
    );
    const response = await s.call(
      "POST",
      `/sessions/${s.sid}/files`,
      "write",
      { path: "b.txt", content: "ANOTHER-CONTENT-MARKER" },
      token,
    );
    assert.equal(response.status, 503);
    assert.doesNotMatch(
      response.text,
      /\bat \w+ \(|node:|\.mjs|\/home\/|\/nonexistent/,
    );
    await sleep(100);
    assert.ok(!runner.output.includes(token));
    assert.ok(!runner.output.includes(token.split(".")[1]));
    assert.ok(!runner.output.includes("CONTENT-MARKER"));
    assert.ok(!runner.output.includes(SECRET));
    const line = runner.output
      .split("\n")
      .filter((entry) => entry.includes('"route":"/sessions/:sid/files"'))
      .at(-1);
    const fields = JSON.parse(line);
    assert.deepEqual(Object.keys(fields).sort(), [
      "code",
      "method",
      "ms",
      "route",
      "sid",
      "status",
      "t",
    ]);
    assert.equal(fields.sid, s.sid);
    assert.equal(fields.status, 503);
  });
});

// ------------------------------------------------------------------ against real Docker

const dockerUp =
  dockerSync(["version", "--format", "{{.Server.Version}}"]).code === 0;

describe(
  "against real Docker",
  { skip: dockerUp ? false : "Docker is not available" },
  () => {
    const instance = `test-${randomUUID().slice(0, 8)}`;
    let runner;
    const open = [];
    /** A Session that is destroyed when the test ends, so the cap of 3 is never hit by accident. */
    const fresh = (t) => {
      const s = session(runner);
      open.push(s);
      t.after(() => s.destroy());
      return s;
    };

    before(async () => {
      runner = await startRunner({
        RUNNER_INSTANCE: instance,
        RUNNER_MAX_SANDBOXES: "3",
      });
    });
    after(async () => {
      await runner.stop();
      assert.deepEqual(containersOf(instance), []);
    });

    test("writes a file, runs Python reading it, runs Node, lists and reads back", async (t) => {
      const s = fresh(t);
      const write = await s.write("data/input.txt", "forty-two\n");
      assert.equal(write.status, 200);
      assert.deepEqual(write.body, {
        path: "data/input.txt",
        bytes: 10,
        sandboxCreated: true,
      });

      const python = await s.run([
        "python3",
        "-c",
        "print(open('data/input.txt').read().strip().upper())",
      ]);
      assert.equal(python.status, 200);
      assert.equal(python.body.exitCode, 0);
      assert.equal(python.body.stdout, "FORTY-TWO\n");
      assert.equal(python.body.stderr, "");
      assert.equal(python.body.timedOut, false);
      assert.equal(python.body.truncated, false);
      assert.equal(python.body.sandboxCreated, false);
      assert.equal(python.body.sandboxReset, false);
      assert.equal(typeof python.body.durationMs, "number");

      await s.write(
        "main.js",
        "const fs = require('fs'); fs.writeFileSync('out.json', JSON.stringify({ n: 6 * 7 })); console.log('node', typeof process.version);",
      );
      const node = await s.run("node main.js && cat out.json");
      assert.equal(node.body.exitCode, 0);
      assert.equal(node.body.stdout, 'node string\n{"n":42}');

      const failing = await s.run("echo to-stderr >&2; exit 3");
      assert.equal(failing.body.exitCode, 3);
      assert.equal(failing.body.stderr, "to-stderr\n");

      const list = await s.list();
      assert.deepEqual(list.body, {
        files: [
          { path: "data/input.txt", size: 10 },
          { path: "main.js", size: 130 },
          { path: "out.json", size: 8 },
        ],
        truncated: false,
      });
      assert.deepEqual((await s.read("./data//input.txt")).body, {
        path: "data/input.txt",
        content: "forty-two\n",
        truncated: false,
      });
      assert.equal((await s.read("nope.txt")).status, 404);

      // Overwrite, and a path whose parent is a file.
      assert.equal((await s.write("data/input.txt", "x")).status, 200);
      assert.equal((await s.read("data/input.txt")).body.content, "x");
      const conflict = await s.write("main.js/inner.txt", "x");
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.error.code, "path_conflict");
      assert.equal(
        (await s.write("data", "x")).body.error.code,
        "path_conflict",
      );

      // A read is cut at 256 KB.
      await s.run(["python3", "-c", "open('big.txt','w').write('y' * 300000)"]);
      const big = await s.read("big.txt");
      assert.equal(big.body.truncated, true);
      assert.equal(big.body.content.length, LIMITS.fileBytes);

      // A link out of the workdir is not a file the Runner reads or writes.
      await s.run("ln -s /etc/passwd link; mkfifo pipe");
      assert.equal((await s.read("link")).status, 404);
      assert.equal(
        (await s.write("link", "x")).body.error.code,
        "path_conflict",
      );
      assert.equal(
        (await s.write("pipe", "x")).body.error.code,
        "path_conflict",
      );
      assert.ok(
        !(await s.list()).body.files.some(
          (file) => file.path === "link" || file.path === "pipe",
        ),
      );
    });

    test("the container is started with every limit", async (t) => {
      const s = fresh(t);
      await s.write("a.txt", "a");
      const inspected = JSON.parse(dockerSync(["inspect", s.name]).stdout)[0];
      const host = inspected.HostConfig;
      assert.equal(host.NetworkMode, "none");
      assert.equal(host.ReadonlyRootfs, true);
      assert.equal(host.Privileged, false);
      assert.deepEqual(host.CapDrop, ["ALL"]);
      assert.equal(host.CapAdd, null);
      assert.ok(host.SecurityOpt.includes("no-new-privileges"));
      assert.equal(host.PidsLimit, 128);
      assert.equal(host.Memory, 512 * 1024 * 1024);
      assert.equal(host.MemorySwap, 512 * 1024 * 1024);
      assert.equal(host.NanoCpus, 1_000_000_000);
      assert.equal(host.Init, true);
      assert.equal(host.AutoRemove, true);
      assert.equal(host.IpcMode, "none");
      assert.equal(host.Binds, null);
      assert.deepEqual(inspected.Mounts, []);
      assert.deepEqual(Object.keys(host.Tmpfs).sort(), ["/tmp", "/work"]);
      assert.match(host.Tmpfs["/work"], /size=64m/);
      assert.match(host.Tmpfs["/tmp"], /size=16m/);
      assert.deepEqual(host.Ulimits.map((limit) => limit.Name).sort(), [
        "core",
        "fsize",
        "msgqueue",
        "nofile",
      ]);
      assert.equal(inspected.Config.User, "sandbox");
      assert.deepEqual(inspected.Config.Cmd, ["sleep", "infinity"]);
      assert.equal(inspected.Config.Labels["harness.sandbox"], "1");
      assert.equal(inspected.Config.Labels["harness.runner"], instance);
      assert.ok(
        Math.abs(
          Number(inspected.Config.Labels["harness.created"]) - nowSeconds(),
        ) < 60,
      );
      assert.ok(!JSON.stringify(inspected).includes("docker.sock"));
    });

    test("runs as a non-root user with no capabilities", async (t) => {
      const s = fresh(t);
      const run = await s.run(
        "id -u; id -un; grep -E '^(CapInh|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs|Seccomp):' /proc/self/status; cat /proc/1/status | grep '^Uid'",
      );
      assert.equal(run.body.exitCode, 0);
      const lines = run.body.stdout.trim().split("\n");
      assert.equal(lines[0], "10001");
      assert.equal(lines[1], "sandbox");
      for (const name of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) {
        assert.ok(lines.includes(`${name}:\t0000000000000000`), name);
      }
      assert.ok(lines.includes("NoNewPrivs:\t1"));
      assert.ok(lines.includes("Seccomp:\t2"));
      assert.match(lines.at(-1), /^Uid:\t10001\t10001\t10001\t10001$/);

      // Docker options in the command are a program name, not options.
      const sneaky = await s.run(["--user", "root", "id"]);
      assert.notEqual(sneaky.body.exitCode, 0);
      assert.doesNotMatch(sneaky.body.stdout, /uid=0/);
      const root = await s.run(
        "su -c id root 2>&1; python3 -c 'import os; os.setuid(0)' 2>&1; id -u",
      );
      assert.equal(root.body.stdout.trim().split("\n").at(-1), "10001");
      assert.match(root.body.stdout, /PermissionError|Operation not permitted/);
    });

    test("the network is unreachable from inside", async (t) => {
      const s = fresh(t);
      const script = [
        "import socket, os",
        "print('ifaces', sorted(os.listdir('/sys/class/net')))",
        "for host, port in (('1.1.1.1', 53), ('172.17.0.1', 80), ('169.254.169.254', 80)):",
        "    try:",
        "        socket.create_connection((host, port), timeout=3)",
        "        print('CONNECTED', host)",
        "    except OSError as e:",
        "        print('refused', host, e.errno)",
        "try:",
        "    socket.getaddrinfo('example.com', 80)",
        "    print('RESOLVED')",
        "except OSError as e:",
        "    print('no dns')",
      ].join("\n");
      await s.write("net.py", script);
      const run = await s.run(["python3", "net.py"]);
      assert.equal(run.body.exitCode, 0, run.body.stderr);
      assert.match(run.body.stdout, /^ifaces \['lo'\]$/m);
      assert.doesNotMatch(run.body.stdout, /CONNECTED|RESOLVED/);
      assert.equal(run.body.stdout.match(/^refused .* 101$/gm).length, 3); // ENETUNREACH
      assert.match(run.body.stdout, /no dns/);
    });

    test("cannot write outside /work and /tmp", async (t) => {
      const s = fresh(t);
      const script = [
        "import os",
        "writable = set()",
        "for root, dirs, files in os.walk('/'):",
        "    if root.startswith(('/proc', '/work', '/tmp')):",
        "        dirs[:] = []",
        "        if root.startswith('/proc'): continue",
        "    probe = os.path.join(root, '.probe')",
        "    try:",
        "        open(probe, 'w').close()",
        "        os.unlink(probe)",
        "        writable.add(root)",
        "    except OSError:",
        "        pass",
        "print(sorted(writable))",
        "print('shm', os.path.exists('/dev/shm'), 'sock', os.path.exists('/var/run/docker.sock') or os.path.exists('/run/docker.sock'))",
      ].join("\n");
      await s.write("probe.py", script);
      const run = await s.run(["python3", "probe.py"]);
      assert.equal(run.body.exitCode, 0, run.body.stderr);
      const lines = run.body.stdout.trim().split("\n");
      assert.equal(lines[0], "['/tmp', '/work']");
      assert.equal(lines[1], "shm False sock False");

      const touch = await s.run(
        "touch /etc/x /x /usr/bin/x /home/x /dev/x /sys/x 2>&1; echo code=$?; echo hi > /tmp/ok && cat /tmp/ok",
      );
      assert.match(touch.body.stdout, /Read-only file system/);
      assert.match(touch.body.stdout, /code=1\nhi\n$/);
      // /tmp holds data but runs nothing.
      const noexec = await s.run(
        "cp /bin/busybox /tmp/bb && /tmp/bb true; echo code=$?",
      );
      assert.match(noexec.body.stdout, /code=126/);
    });

    test("a timeout kills the whole process tree and is reported", async (t) => {
      const s = fresh(t);
      await s.write("keep.txt", "still here");
      await s.write(
        "spawn.py",
        "import subprocess, time\nsubprocess.Popen(['sh', '-c', 'sleep 300 & sleep 300'], start_new_session=True)\nprint('started')\ntime.sleep(300)\n",
      );
      const started = Date.now();
      const run = await s.run(["python3", "spawn.py"], 1500);
      assert.equal(run.status, 200);
      assert.equal(run.body.timedOut, true);
      assert.equal(run.body.exitCode, 124);
      assert.equal(run.body.stdout, "started\n");
      assert.equal(run.body.sandboxReset, false);
      assert.ok(
        run.body.durationMs >= 1500 && run.body.durationMs < 8000,
        String(run.body.durationMs),
      );
      assert.ok(Date.now() - started < 12_000);

      // Nothing of the run is left in the container (checked from the host), and the files are.
      const top = dockerSync(["top", s.name, "-eo", "pid,args"]).stdout;
      assert.doesNotMatch(top, /sleep 300|python3/);
      assert.match(top, /sleep infinity/);
      assert.equal((await s.read("keep.txt")).body.content, "still here");

      // A background process does not outlive a run that ends normally either.
      const background = await s.run(
        "nohup sleep 200 >/dev/null 2>&1 & echo done",
      );
      assert.equal(background.body.stdout, "done\n");
      assert.equal(background.body.timedOut, false);
      assert.doesNotMatch(
        dockerSync(["top", s.name, "-eo", "pid,args"]).stdout,
        /sleep 200/,
      );
    });

    test("output is capped at 64 KB per stream and flagged", async (t) => {
      const s = fresh(t);
      const run = await s.run([
        "python3",
        "-c",
        "import sys\nsys.stdout.write('o' * 200000)\nsys.stderr.write('e' * 100)",
      ]);
      assert.equal(run.body.exitCode, 0);
      assert.equal(run.body.truncated, true);
      assert.equal(run.body.stdout.length, LIMITS.outputBytes);
      assert.equal(run.body.stderr.length, 100);
      const errors = await s.run([
        "python3",
        "-c",
        "import sys\nsys.stderr.write('e' * 200000)",
      ]);
      assert.equal(errors.body.truncated, true);
      assert.equal(errors.body.stderr.length, LIMITS.outputBytes);
      const small = await s.run("echo small");
      assert.equal(small.body.truncated, false);

      // An endless stream is stopped long before its timeout.
      const started = Date.now();
      const flood = await s.run("yes flood", 30_000);
      assert.equal(flood.body.truncated, true);
      assert.equal(flood.body.timedOut, false);
      assert.equal(flood.body.stdout.length, LIMITS.outputBytes);
      assert.ok(Date.now() - started < 20_000);
      assert.doesNotMatch(
        dockerSync(["top", s.name, "-eo", "pid,args"]).stdout,
        /yes flood/,
      );
    });

    test("a fork bomb is contained and the Runner keeps answering", async (t) => {
      const s = fresh(t);
      await s.write("keep.txt", "k");
      const bomb = s.run(
        [
          "python3",
          "-c",
          "import os\nwhile True:\n    try:\n        os.fork()\n    except OSError:\n        pass",
        ],
        2500,
      );
      await sleep(1200);
      const pids =
        dockerSync(["top", s.name, "-eo", "pid"]).stdout.trim().split("\n")
          .length - 1;
      assert.ok(pids > 20 && pids <= 128, `pids in the container: ${pids}`);
      for (let i = 0; i < 3; i += 1) {
        const started = Date.now();
        const health = await fetch(`${runner.base}/health`);
        assert.equal(health.status, 200);
        assert.equal((await health.json()).docker, true);
        assert.ok(Date.now() - started < 3000);
      }
      const other = fresh(t);
      assert.equal((await other.run("echo fine")).body.stdout, "fine\n");

      const result = await bomb;
      assert.equal(result.status, 200);
      assert.equal(result.body.timedOut, true);
      assert.equal(result.body.exitCode, 124);
      // The Sandbox was either swept clean or removed: nothing of the bomb is left.
      const left = dockerSync(["top", s.name, "-eo", "pid,args"]);
      if (result.body.sandboxReset) assert.notEqual(left.code, 0);
      else assert.doesNotMatch(left.stdout, /python3/);
      const next = await s.run("echo again; ls");
      assert.equal(next.body.exitCode, 0);
      assert.equal(next.body.sandboxCreated, result.body.sandboxReset);
      assert.equal(
        next.body.stdout,
        result.body.sandboxReset ? "again\n" : "again\nkeep.txt\n",
      );
    });

    test("a memory hog and a disk hog are stopped at the limits", async (t) => {
      const s = fresh(t);
      const hog = await s.run(
        [
          "python3",
          "-c",
          "chunks = []\nwhile True:\n    chunks.append(b'x' * (16 * 1024 * 1024))\n    print(len(chunks) * 16, flush=True)",
        ],
        30_000,
      );
      assert.equal(hog.status, 200);
      assert.equal(hog.body.timedOut, false);
      assert.equal(hog.body.exitCode, 137); // killed by the kernel at the memory limit
      const reached = Number(hog.body.stdout.trim().split("\n").at(-1));
      assert.ok(
        reached >= 256 && reached <= 512,
        `allocated ${reached} MB before the kill`,
      );
      assert.equal((await fetch(`${runner.base}/health`)).status, 200);
      assert.equal((await s.run("echo alive")).body.stdout, "alive\n");

      const disk = await s.run(
        "ulimit -f; dd if=/dev/zero of=/work/pad bs=1M count=1 2>/dev/null; dd if=/dev/zero of=/work/big bs=1M count=200 2>&1; echo code=$?; du -m /work/big | cut -f1; dd if=/dev/zero of=/tmp/big bs=1M count=200 2>/dev/null; du -m /tmp/big | cut -f1",
      );
      assert.match(disk.body.stdout, /^131072\n/); // the 64 MB file size limit, in 512-byte blocks
      assert.match(disk.body.stdout, /No space left on device/);
      assert.match(disk.body.stdout, /code=1\n63\n16\n$/);
      const full = await s.write("more.txt", "x".repeat(5000));
      assert.equal(full.status, 507);
      assert.equal(full.body.error.code, "workdir_full");
      assert.ok(
        !(await s.list()).body.files.some((file) => file.path === "more.txt"),
      );
    });

    test("a Sandbox holds at most 200 files through the API", async (t) => {
      const s = fresh(t);
      await s.run(
        "i=0; while [ $i -lt 200 ]; do : > f$i.txt; i=$((i+1)); done",
      );
      const extra = await s.write("one-more.txt", "x");
      assert.equal(extra.status, 409);
      assert.equal(extra.body.error.code, "too_many_files");
      assert.equal((await s.write("f7.txt", "overwrite is fine")).status, 200);
      const list = await s.list();
      assert.equal(list.body.files.length, 200);
      assert.equal(list.body.truncated, false);
    });

    test("concurrent requests for one Session share one container", async (t) => {
      const s = fresh(t);
      const results = await Promise.all([
        s.write("a.txt", "a"),
        s.write("b.txt", "b"),
        s.run("echo c > c.txt"),
        s.write("d.txt", "d"),
      ]);
      assert.deepEqual(
        results.map((result) => result.status),
        [200, 200, 200, 200],
      );
      assert.equal(
        results.filter((result) => result.body.sandboxCreated).length,
        1,
      );
      assert.deepEqual(
        (await s.list()).body.files.map((file) => file.path),
        ["a.txt", "b.txt", "c.txt", "d.txt"],
      );
      assert.equal(
        containersOf(instance).filter((name) => name === s.name).length,
        1,
      );

      // A fifth request while four wait is turned away rather than queued without end.
      const slow = s.run("sleep 2");
      await sleep(500);
      const burst = await Promise.all([s.list(), s.list(), s.list(), s.list()]);
      assert.deepEqual(
        burst.map((result) => result.status).sort(),
        [200, 200, 200, 429],
      );
      assert.equal(
        burst.find((result) => result.status === 429).body.error.code,
        "session_busy",
      );
      assert.equal((await slow).status, 200);
    });

    test("the cap on live Sandboxes answers 503, and destroy removes the container", async () => {
      for (const s of open) await s.destroy();
      const three = [session(runner), session(runner), session(runner)];
      for (const s of three)
        assert.equal((await s.write("a.txt", "a")).status, 200);
      assert.deepEqual(await (await fetch(`${runner.base}/health`)).json(), {
        ok: true,
        docker: true,
        live: 3,
        max: 3,
      });

      const fourth = session(runner);
      for (const response of [
        await fourth.write("a.txt", "a"),
        await fourth.run("echo hi"),
      ]) {
        assert.equal(response.status, 503);
        assert.equal(response.body.error.code, "at_capacity");
        assert.match(response.body.error.message, /All 3 Sandboxes are in use/);
        assert.equal(response.headers.get("retry-after"), "60");
      }
      assert.ok(!containersOf(instance).includes(fourth.name));
      assert.equal(containersOf(instance).length, 3);

      const destroyed = await three[0].destroy();
      assert.deepEqual(destroyed.body, { destroyed: true });
      assert.ok(
        !dockerSync(["ps", "-a", "--format", "{{.Names}}"]).stdout.includes(
          three[0].name,
        ),
      );
      assert.deepEqual((await three[0].destroy()).body, { destroyed: false });
      assert.deepEqual((await three[0].list()).body, {
        files: [],
        truncated: false,
      });

      // The freed slot is usable, and a Sandbox killed behind the Runner's back frees its slot too.
      assert.equal((await fourth.write("a.txt", "a")).status, 200);
      dockerSync(["kill", three[1].name]);
      const fifth = session(runner);
      assert.equal((await fifth.write("a.txt", "a")).status, 200);
      const reborn = await three[2].run("kill -9 -1");
      assert.equal(reborn.body.sandboxReset, true);
      const again = await three[2].run("ls");
      assert.equal(again.body.sandboxCreated, true);
      assert.equal(again.body.stdout, "");
      for (const s of [...three, fourth, fifth]) await s.destroy();
      assert.deepEqual(containersOf(instance), []);
    });

    test("the 31st run of a Session in ten minutes answers 429", async (t) => {
      const s = fresh(t);
      for (let i = 0; i < 30; i += 1) {
        const run = await s.run(["true"]);
        assert.equal(run.status, 200, `run ${i + 1}`);
      }
      const limited = await s.run(["true"]);
      assert.equal(limited.status, 429);
      assert.equal(limited.body.error.code, "rate_limited");
      assert.ok(Number(limited.headers.get("retry-after")) > 500);
      // Other actions and other Sessions are not affected.
      assert.equal((await s.list()).status, 200);
      assert.equal((await fresh(t).run(["true"])).status, 200);
    });

    test("idle Sandboxes are reaped, leftovers are reaped on start, SIGTERM removes all", async () => {
      const second = `test-${randomUUID().slice(0, 8)}`;
      const envFor = {
        RUNNER_INSTANCE: second,
        RUNNER_IDLE_MINUTES: "0.05",
        RUNNER_REAP_SECONDS: "1",
      };
      let other = await startRunner(envFor);
      try {
        const idle = session(other);
        assert.equal((await idle.write("a.txt", "a")).status, 200);
        assert.deepEqual(containersOf(second), [idle.name]);
        for (let i = 0; i < 40 && containersOf(second).length > 0; i += 1)
          await sleep(250);
        assert.deepEqual(
          containersOf(second),
          [],
          "the idle Sandbox was not reaped",
        );
        assert.equal(
          (await (await fetch(`${other.base}/health`)).json()).live,
          0,
        );
        // The main Runner's Sandboxes are not this instance's to reap.
        const mine = session(runner);
        await mine.write("a.txt", "a");
        await sleep(1500);
        assert.deepEqual(containersOf(instance), [mine.name]);
        await mine.destroy();

        // Kill the Runner hard: its Sandbox is left behind, and the next start removes it.
        const orphan = session(other);
        assert.equal((await orphan.write("a.txt", "a")).status, 200);
        await other.stop("SIGKILL");
        assert.deepEqual(containersOf(second), [orphan.name]);
        other = await startRunner({ ...envFor, RUNNER_IDLE_MINUTES: "15" });
        assert.deepEqual(containersOf(second), []);
        assert.match(other.output, /"event":"reaped_leftovers","count":1/);

        const a = session(other);
        const b = session(other);
        await a.write("a.txt", "a");
        await b.write("b.txt", "b");
        assert.equal(containersOf(second).length, 2);
        const { code } = await other.stop("SIGTERM");
        assert.equal(code, 0);
        assert.deepEqual(containersOf(second), []);
      } finally {
        await other.stop("SIGKILL");
        for (const name of containersOf(second)) dockerSync(["rm", "-f", name]);
      }
    });
  },
);
