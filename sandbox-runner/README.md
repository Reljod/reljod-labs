# Sandbox Runner

The Runner is the small HTTP service on the VPS that starts and drives Sandboxes for the Harness. A Sandbox is one Docker container where the Agent writes and runs code for one chat Session. Decision and reasons: `docs/adr/0017-sandbox-runner-on-the-vps.md`.

It is plain Node (built-ins only, no install, no build step), tested on Node 22 and 26. It drives Docker through the `docker` CLI.

| File | What it is |
| --- | --- |
| `runner.mjs` | The service. |
| `token.mjs` | The token format, `sign` and `verify`. The app copies this algorithm. |
| `validate.mjs` | Checks on session ids, paths, commands and timeouts. |
| `Dockerfile` | The Sandbox image: Python 3, Node, a user `sandbox`, a `/work` directory. |
| `install.sh` | Sets the Runner up on the VPS. Run by the owner, as root. |
| `harness-sandbox.service` | The systemd unit template `install.sh` fills in. |
| `Caddyfile.snippet` | The Caddy site that puts TLS in front. |
| `test.mjs` | `node --test`. |

## Threat model

Any visitor of the public demo can make the Agent write and run code, so the Runner assumes two things: every request body is hostile, and the code in a container is malicious.

What stands between that code and the VPS:

- **No network.** The container has only a loopback interface. It cannot reach the internet, the host, other containers or the cloud metadata address.
- **Nothing of the host inside.** No volumes, no host paths, no Docker socket. The root file system is read-only. The only writable places are `/work` (64 MB, in memory) and `/tmp` (16 MB, in memory, nothing in it can be executed). `/dev/shm` is absent and POSIX message queues are disabled.
- **No privileges.** It runs as the user `sandbox` (uid 10001), with every capability dropped and `no-new-privileges`, under Docker's default seccomp and AppArmor profiles.
- **Limits.** 1 CPU, 512 MB memory with no swap, 128 processes, 256 open files, 64 MB per file, 60 seconds per command, 64 KB of output kept per stream.
- **Nothing lingers.** After every command the Runner ends every process in the container, so the only thing a run leaves behind is files. A Sandbox is removed when the Session ends, after 15 idle minutes, after 2 hours at the latest, and when the Runner stops.
- **A cap.** At most 6 Sandboxes live at once. The seventh Session is told to try later.

What stands between a stranger and the Runner:

- It listens on `127.0.0.1` only. Caddy adds TLS.
- Every request but `/health` needs a token the app signed with a shared secret. A token names one Session and one action and lasts at most five minutes.
- Request input never becomes part of a command line. Session ids must be UUIDs, file paths are checked and passed as a single argument to a fixed script, and a command string is only ever interpreted by a shell inside the container.

**The risk that is accepted.** The containers run on runc, Docker's default runtime, which shares the host's kernel. There is no gVisor or VM in between. A kernel bug that lets code break out of a container would put it on the VPS, as uid 10001, with whatever that bug grants. The limits above make this hard to reach and nothing more. This is accepted for the demo and must be revisited before anything else of value shares the machine.

Other things to know:

- The Runner's user is in the `docker` group, which is root on the host in all but name. The systemd hardening contains a bug in the Runner process; it does not contain someone who can make the Runner send arbitrary Docker commands. The input checks are what prevent that.
- Docker's user-namespace remapping is not turned on (it is a daemon-wide setting and would affect the other containers on the VPS). So uid 10001 in a Sandbox is uid 10001 on the host. No such user exists there.
- A token authorises an action on a Session, not a particular body. Whoever holds a valid `run` token can run any command in that Session until it expires. Keep tokens short-lived (60 seconds is plenty) and never log them.
- Six Sandboxes at full tilt use six CPU cores and 3 GB of memory. Lower `RUNNER_MAX_SANDBOXES` if the VPS has other work to do.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `RUNNER_SECRET` | none, required | The shared secret, at least 32 characters. The Runner refuses to start without it. The app holds the same value as `HARNESS_SANDBOX_SECRET`. |
| `RUNNER_PORT` | `8787` | Port on `127.0.0.1`. `0` picks a free one (used by the tests). |
| `RUNNER_MAX_SANDBOXES` | `6` | Live Sandboxes at once. |
| `RUNNER_IDLE_MINUTES` | `15` | A Sandbox unused this long is removed. |
| `RUNNER_REAP_SECONDS` | `30` | How often the reaper looks. |
| `RUNNER_IMAGE` | `harness-sandbox:1` | The Sandbox image. Built from `Dockerfile` on first need if absent. |
| `RUNNER_INSTANCE` | `main` | Written on each container as the label `harness.runner`. A Runner only removes leftovers of its own instance, so a test Runner and the real one can share a host. |
| `RUNNER_DOCKER_BIN` | `docker` | The Docker CLI to run. |

Fixed limits (in `validate.mjs` and at the top of `runner.mjs`): body 512 KB, file 256 KB, 200 files, path 200 bytes, output 64 KB per stream, command timeout 100 ms to 60 s, Sandbox lifetime 2 hours.

## Running it

```
docker build -t harness-sandbox:1 sandbox-runner/     # optional: the Runner builds it if absent
RUNNER_SECRET=... node sandbox-runner/runner.mjs
```

On the VPS, the owner runs `sudo ./install.sh sandbox.example.com` once. It creates the user `harness-runner`, copies the Runner to `/opt/harness-sandbox`, builds the image, writes `/etc/harness-sandbox/runner.env` with a generated secret (never printed), installs and starts the systemd unit, and prints the Caddy site to add and the two Vercel variables to set. It changes neither Caddy nor DNS. It is safe to run again.

## How the app reaches it

The Harness runs on Vercel. It has `HARNESS_SANDBOX_URL` (for example `https://sandbox.example.com`; unset means the Sandbox is off) and `HARNESS_SANDBOX_SECRET`. For each call it signs a token for that Session and action with about 60 seconds to live and sends it as `Authorization: Bearer <token>`. Caddy on the VPS terminates TLS and proxies to `127.0.0.1:8787`.

A run answers after at most its `timeoutMs` plus clean-up. Clean-up is usually a fraction of a second and can take around 20 seconds after something like a fork bomb. The calling function's own time limit must allow for that (Caddy waits 90 seconds), or it should pass a smaller `timeoutMs`. If the Runner cannot be reached or answers 5xx, the app says "Sandbox offline".

## Token

```
payload = UTF-8 bytes of the JSON  {"sid":"<session uuid>","exp":<unix seconds>,"act":"<action>"}
mac     = HMAC-SHA256(key = UTF-8 bytes of the secret, message = payload)
token   = base64url(payload) + "." + base64url(mac)        # base64url without "=" padding
header  = Authorization: Bearer <token>
```

`act` is one of `write`, `read`, `list`, `run`, `destroy`. The Runner checks the MAC with `timingSafeEqual`, then that `exp` is in the future and at most 300 seconds ahead, that `sid` is the session in the URL and that `act` is the action of the route.

In TypeScript on the app side:

```ts
import { createHmac } from "node:crypto";

function signSandboxToken(secret: string, sid: string, act: "write" | "read" | "list" | "run" | "destroy") {
  const payload = Buffer.from(JSON.stringify({ sid, exp: Math.floor(Date.now() / 1000) + 60, act }), "utf8");
  const mac = createHmac("sha256", secret).update(payload).digest();
  return `${payload.toString("base64url")}.${mac.toString("base64url")}`;
}
```

Test vector (also asserted in `test.mjs`):

```
secret   0123456789abcdef0123456789abcdef
payload  {"sid":"123e4567-e89b-42d3-a456-426614174000","exp":1800000000,"act":"run"}
token    eyJzaWQiOiIxMjNlNDU2Ny1lODliLTQyZDMtYTQ1Ni00MjY2MTQxNzQwMDAiLCJleHAiOjE4MDAwMDAwMDAsImFjdCI6InJ1biJ9.x4d1b-3_LfP2u9e6oBe0EiThcaQkgAljs49d_G9LxTU
```

The payload has no spaces and its keys are in the order `sid`, `exp`, `act` (what `JSON.stringify` gives for that object literal). The verifier accepts any JSON layout, since the MAC covers the bytes sent; the vector only matches with this one.

## API

JSON in and out. `:sid` is the Session id, a lower-case UUID. Every response has `Cache-Control: no-store`.

### `GET /health` (no token)

`200 { "ok": true, "docker": true, "live": 2, "max": 6 }`. `docker` says whether the Docker daemon answers, `live` is the number of Sandboxes, `ok` is false when Docker is down or the Runner is shutting down.

### `POST /sessions/:sid/files` (act `write`)

Body `{ "path": "src/main.py", "content": "print(1)\n" }`. Starts the Sandbox if the Session has none. Creates parent directories, overwrites an existing file. `content` is text, written as UTF-8, at most 256 KB.

`200 { "path": "src/main.py", "bytes": 9, "sandboxCreated": false }`. `path` is the tidied path (`./a//b` becomes `a/b`). `sandboxCreated` is true when this request started a new Sandbox, which also means any earlier files of the Session are gone.

### `GET /sessions/:sid/files?path=src/main.py` (act `read`)

`200 { "path": "src/main.py", "content": "print(1)\n", "truncated": false }`. At most the first 256 KB, decoded as UTF-8 (bytes that are not UTF-8 become U+FFFD). `404 file_not_found` if there is no such regular file, or no Sandbox. A read never starts a Sandbox. A path whose last part is a symbolic link is refused, for `read` and `write` alike.

### `GET /sessions/:sid/files` (act `list`)

`200 { "files": [ { "path": "src/main.py", "size": 9 } ], "truncated": false }`. Regular files under the workdir, sorted by path, at most 200. No Sandbox gives an empty list. Files whose names a request could not use (control characters, a backslash, over 200 bytes) are left out.

### `POST /sessions/:sid/run` (act `run`)

Body `{ "command": ["python3", "src/main.py"], "timeoutMs": 20000 }`. Starts the Sandbox if the Session has none.

- `command` as an array (1 to 64 strings) is executed as is, no shell. As a string it runs under `sh -lc` inside the container. At most 64 KB in total.
- `timeoutMs` is optional, an integer from 100 to 60000. The default is 60000.
- The command runs in `/work` as `sandbox`, with `HOME=/work`. The image has `python3`, `node` and BusyBox tools. There is no `pip`/`npm` registry to reach.

```
200 {
  "exitCode": 0, "stdout": "1\n", "stderr": "",
  "truncated": false, "timedOut": false, "durationMs": 153,
  "sandboxCreated": false, "sandboxReset": false
}
```

- `exitCode` is the command's own. `124` with `timedOut: true` when it hit the timeout. `137` when it was killed (out of memory, or output far beyond the cap). `127` or `126` when the program does not exist or cannot be executed; Docker's message is then in `stdout`.
- `stdout` and `stderr` hold the first 64 KB of each stream. `truncated` is true if either was cut. A command that floods output (more than 16 MB thrown away) is stopped early.
- `durationMs` is the time until the command was gone. After a timeout it can exceed `timeoutMs` by a few seconds, the time it took to end the processes.
- A command that fails is still `200`. Only the Runner's own failures use an error status.
- Every process the command started is ended when it returns, including background ones.
- `sandboxReset: true` means the Sandbox could not be cleaned up after this command (for example the code killed the container, or left no free process slot) and was removed. Its files are gone; the next `write` or `run` starts a new one.

### `DELETE /sessions/:sid` (act `destroy`)

`200 { "destroyed": true }`. `false` when the Session had no Sandbox. Safe to repeat.

### Errors

`{ "error": { "code": "...", "message": "..." } }`. The message is safe to show.

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalid_session` | `:sid` is not a lower-case UUID. |
| 400 | `invalid_json`, `invalid_body` | The body is not JSON, or not a JSON object. |
| 400 | `invalid_path` | Empty, absolute, has `..`, a control character or a backslash, ends in `/`, or over 200 bytes. |
| 400 | `invalid_content` | `content` is not a string. |
| 400 | `invalid_command`, `invalid_timeout` | See `run`. |
| 400 | `invalid_request` | The URL cannot be parsed. |
| 401 | `unauthorized` | No token, not a token, or a wrong signature. |
| 401 | `token_expired` | Signed correctly, but expired or expiring more than 300 s ahead. |
| 403 | `forbidden` | Signed correctly, but for another Session or another action. |
| 404 | `not_found` | No such route. |
| 404 | `file_not_found` | `read` only. |
| 405 | `method_not_allowed` | With an `Allow` header. |
| 409 | `path_conflict` | `write`: the path is a directory, a link or a special file, or a parent is a file. |
| 409 | `too_many_files` | `write`: the Sandbox already holds 200 files. |
| 413 | `body_too_large` | The body is over 512 KB. |
| 413 | `file_too_large` | `content` is over 256 KB. |
| 429 | `rate_limited` | Too many requests. `Retry-After` in seconds. |
| 429 | `session_busy` | The Session already has 4 requests running or waiting. |
| 500 | `sandbox_error`, `internal` | The Sandbox or the Runner misbehaved. |
| 503 | `at_capacity` | All Sandboxes are in use. `Retry-After: 60`. |
| 503 | `sandbox_unavailable` | Docker is down, or the image or container could not be started. |
| 503 | `shutting_down` | The Runner is stopping. |
| 507 | `workdir_full` | `write`: no room left in the 64 MB workdir. |

Order of checks: route, method, session id, token, rate limits, body size, body content.

Rate limits, per Session per 10 minutes: 30 `run`, 120 `write`, 240 `read`, 240 `list`, 30 `destroy`. Across all Sessions: 600 signed requests per minute. Requests without a valid token are refused before they count. Requests for one Session are handled one at a time, in order.

## Logs

One JSON line per request on stdout: `{"t":"…","method":"POST","route":"/sessions/:sid/run","sid":"…","status":200,"ms":212}`, plus `code` on an error. Tokens, bodies, commands and file contents are never logged. Lifecycle events (`listening`, `image_build`, `reaped`, `shutdown`, `sandbox_start_failed`, `exec_failed`) are lines with an `event` field; the failure ones carry up to 300 characters of Docker's error text, which can include a file name.

## Tests

```
node --test sandbox-runner/            # Node 26
node --test sandbox-runner/test.mjs    # Node 22, whose test runner does not take a directory
```

The unit tests need nothing. The integration tests start real Runners on random ports and real containers, and are skipped when Docker is not available. They take about a minute, use their own `RUNNER_INSTANCE`, and remove every container they start. They leave the image `harness-sandbox:1` and its base `python:3.13-alpine` in place.

Check that nothing is left: `docker ps -a --filter label=harness.sandbox=1`.
