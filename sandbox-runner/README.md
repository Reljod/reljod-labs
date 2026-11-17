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

- **A sandboxed runtime (gVisor).** The recommended and default setup runs every container on gVisor (`runsc`, `RUNNER_RUNTIME=runsc`): the code's system calls go to gVisor's own kernel in user space, not to the host's. The Runner starts without further ado only on a sandboxed runtime: `runsc`, or a Kata Containers runtime (a name starting with `kata`). On anything else, Docker's default runc, crun, or a name it does not know, it refuses to start unless the owner sets `RUNNER_ALLOW_RUNC=1` (see "Isolation" below).
- **No network.** The container has only a loopback interface. It cannot reach the internet, the host, other containers or the cloud metadata address.
- **Nothing of the host inside.** No volumes, no host paths, no Docker socket. The root file system is read-only. The only writable places are `/work` (64 MB, in memory) and `/tmp` (16 MB, in memory). Both are mounted `noexec`: a file written there cannot be run directly, only read by an interpreter (`python3 main.py`, `node main.js`, `sh run.sh`). `/dev/shm` is absent and POSIX message queues are disabled.
- **No privileges.** It runs as the user `sandbox` (uid 10001), with every capability dropped and `no-new-privileges`, under Docker's default seccomp and AppArmor profiles.
- **Limits.** 1 CPU, 512 MB memory with no swap, 128 processes, 256 open files, 64 MB per file, 60 seconds per command, 64 KB of output kept per stream.
- **Nothing lingers.** After every command the Runner ends every process in the container, so the only thing a run leaves behind is files. A Sandbox is removed after 15 idle minutes, after 2 hours at the latest, when the app asks (`DELETE`), and when the Runner stops. The idle reaper is what normally ends one: the app does not yet close a Sandbox when a Session ends.
- **Caps.** At most 6 Sandboxes live at once, and at most 2 per Owner (`RUNNER_MAX_PER_OWNER`), so one visitor cannot take every slot. With `RUNNER_CGROUP_PARENT` set (`install.sh` sets it to `harness-sandbox.slice`, `CPUQuota=200%`, `MemoryMax=2G`), all Sandboxes together get at most two CPUs and 2 GB. Without the slice, six busy Sandboxes can pin six CPUs and take 3 GB.

What stands between a stranger and the Runner:

- It listens on `127.0.0.1` only. Caddy adds TLS.
- Every request but `/health` needs a token the app signed with a shared secret. A token names one Session and one action and lasts at most five minutes. `/health` says only `{ "ok": true }`; the counts are behind the signed `/status`.
- Request input never becomes part of a command line. Session ids must be UUIDs, file paths are checked and passed as a single argument to a fixed script, and a command string is only ever interpreted by a shell inside the container.

## Isolation

**This VPS holds secrets.** It runs other services and holds, among other things, a password manager's service-account token and an agent's home directory. Visitor code must not be one kernel bug away from them.

**Recommended: gVisor.** Install it with the upstream commands (from <https://gvisor.dev/docs/user_guide/install/> and the Docker quick start), as root:

```
sudo apt-get update && sudo apt-get install -y apt-transport-https ca-certificates curl gnupg
curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list > /dev/null
sudo apt-get update && sudo apt-get install -y runsc
sudo runsc install            # registers runsc in /etc/docker/daemon.json
sudo systemctl restart docker
```

Check it, then run `install.sh`, which sees `runsc` and sets `RUNNER_RUNTIME=runsc`:

```
docker info --format '{{json .Runtimes}}'      # must list "runsc"
docker run --runtime=runsc --rm hello-world
```

The Runner's flags (read-only root, tmpfs, no network, dropped capabilities, `--init`, limits) are the same under gVisor. The integration tests in `test.mjs` were run on runc (this machine has no gVisor yet); run them once with `RUNNER_RUNTIME=runsc` after installing it, and expect small differences in what `/proc/self/status` reports.

**The alternative, explicitly: runc.** With `RUNNER_RUNTIME` unset, or set to anything outside the allowlist of sandboxed runtimes (`runsc`, and names starting with `kata`), such as `runc` or `crun`, the Runner exits at start (status 78) unless `RUNNER_ALLOW_RUNC=1` is set. The check is an allowlist on purpose: crun, youki and the like share the host's kernel just as runc does. `install.sh` never sets it; the owner writes it into `/etc/harness-sandbox/runner.env` by hand. Setting it means accepting this: runc containers share the host's kernel, and the code in them comes from any visitor (anyone can switch to the admin Staff member, ADR 0014). A kernel bug reachable through Docker's default seccomp profile would put that code on the VPS as uid 10001, or as root if the bug grants it. As root it reads every file on the machine, including the password manager's token and the agent's home, and drives the Docker socket. The limits above make such a bug harder to reach; they do not remove it. Allow runc only on a machine that holds nothing you would mind a stranger reading or using.

Other things to know:

- The Runner's user is in the `docker` group, which is root on the host in all but name. The systemd hardening contains a bug in the Runner process; it does not contain someone who can make the Runner send arbitrary Docker commands. The input checks are what prevent that.
- Docker's user-namespace remapping is not turned on (it is a daemon-wide setting and would affect the other containers on the VPS). So uid 10001 in a Sandbox is uid 10001 on the host. No such user exists there.
- A token authorises an action on a Session, not a particular body. Whoever holds a valid `run` token can run any command in that Session until it expires. Keep tokens short-lived (60 seconds is plenty) and never log them.
- Six Sandboxes at full tilt use six CPU cores and 3 GB of memory unless they share a capped slice (`RUNNER_CGROUP_PARENT`). Lower `RUNNER_MAX_SANDBOXES` too if the VPS has other work to do.
- The Owner tag in a token is an HMAC of the app's Owner id. The Runner sees only the tag, and labels each container with it (`harness.owner`) to count Sandboxes per Owner.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `RUNNER_SECRET` | none, required | The shared secret, at least 32 characters. The Runner refuses to start without it. The app holds the same value as `HARNESS_SANDBOX_SECRET`. |
| `RUNNER_PORT` | `8787` | Port on `127.0.0.1`. `0` picks a free one (used by the tests). |
| `RUNNER_MAX_SANDBOXES` | `6` | Live Sandboxes at once. |
| `RUNNER_MAX_PER_OWNER` | `2` | Live Sandboxes per Owner tag. A third answers `429 owner_at_capacity`. |
| `RUNNER_RUNTIME` | none | Passed as `docker run --runtime <value>`; must match `^[a-z0-9_-]+$`. Set `runsc` for gVisor. Only `runsc` and names starting with `kata` count as sandboxed; unset or anything else (`runc`, `crun`, ...) refuses to start unless `RUNNER_ALLOW_RUNC=1`. |
| `RUNNER_ALLOW_RUNC` | none | `1` accepts running on runc or any other runtime that shares the host kernel, with the risk under "Isolation". Any other value is no. |
| `RUNNER_CGROUP_PARENT` | none | Passed as `docker run --cgroup-parent <value>`, e.g. `harness-sandbox.slice`, so all Sandboxes share one capped cgroup. |
| `RUNNER_IDLE_MINUTES` | `15` | A Sandbox unused this long is removed. |
| `RUNNER_REAP_SECONDS` | `30` | How often the reaper looks. |
| `RUNNER_IMAGE` | `harness-sandbox:1` | The Sandbox image. Built from `Dockerfile` on first need if absent. |
| `RUNNER_INSTANCE` | `main` | Written on each container as the label `harness.runner`. A Runner only removes leftovers of its own instance, so a test Runner and the real one can share a host. |
| `RUNNER_DOCKER_BIN` | `docker` | The Docker CLI to run. |

Fixed limits (in `validate.mjs` and at the top of `runner.mjs`): body 512 KB, file 256 KB, 200 files, path 200 bytes, output 64 KB per stream, command timeout 100 ms to 60 s, Sandbox lifetime 2 hours.

## Running it

```
docker build -t harness-sandbox:1 sandbox-runner/     # optional: the Runner builds it if absent
RUNNER_SECRET=... RUNNER_RUNTIME=runsc node sandbox-runner/runner.mjs     # or RUNNER_ALLOW_RUNC=1 on a machine with nothing to protect
```

On the VPS, the owner installs gVisor (above), then runs `sudo ./install.sh sandbox.example.com` once. It checks that Docker lists `runsc` (and stops with the two choices if not), creates the user `harness-runner`, copies the Runner to `/opt/harness-sandbox`, builds the image, writes `/etc/harness-sandbox/runner.env` with a generated secret (never printed), `RUNNER_RUNTIME=runsc` and `RUNNER_CGROUP_PARENT=harness-sandbox.slice`, writes that slice (`CPUQuota=200%`, `MemoryMax=2G`), installs and starts the systemd unit, and prints the Caddy site to add and the two Vercel variables to set. It changes neither Caddy nor DNS. It is safe to run again.

## How the app reaches it

The Harness runs on Vercel. It has `HARNESS_SANDBOX_URL` (for example `https://sandbox.example.com`; unset means the Sandbox is off; it must be `https:`, or `http:` on a loopback host for local development, or the app treats the Sandbox as off) and `HARNESS_SANDBOX_SECRET`. For each call it signs a token for that Session and action with about 60 seconds to live and sends it as `Authorization: Bearer <token>`. Caddy on the VPS terminates TLS and proxies to `127.0.0.1:8787`.

A run answers after at most its `timeoutMs` plus clean-up. Clean-up is usually a fraction of a second and can take around 20 seconds after something like a fork bomb. The calling function's own time limit must allow for that (Caddy waits 90 seconds), or it should pass a smaller `timeoutMs`. If the Runner cannot be reached or answers 5xx, the app says "Sandbox offline".

## Token

```
payload = UTF-8 bytes of the JSON  {"sid":"<session uuid>","exp":<unix seconds>,"act":"<action>","own":"<owner tag>"}
mac     = HMAC-SHA256(key = UTF-8 bytes of the secret, message = payload)
token   = base64url(payload) + "." + base64url(mac)        # base64url without "=" padding
header  = Authorization: Bearer <token>
```

`act` is one of `write`, `read`, `list`, `run`, `destroy`, `status`. The Runner checks the MAC with `timingSafeEqual`, then that `exp` is in the future and at most 300 seconds ahead, that `sid` is the session in the URL (the empty string for `status`) and that `act` is the action of the route.

`own` is the Owner tag: 16 to 64 base64url characters, opaque to the Runner. `write` and `run` (the actions that can start a Sandbox) refuse a token without one (`403`). The app derives it as the first 22 base64url characters of `HMAC-SHA256(key = secret, message = "harness-sandbox-owner:" + owner)` (`sandboxOwnerTag` in `src/features/harness/domain/sandbox-token.ts`).

In TypeScript on the app side:

```ts
import { createHmac } from "node:crypto";

function signSandboxToken(secret: string, sid: string, act: "write" | "read" | "list" | "run" | "destroy" | "status", own: string) {
  const payload = Buffer.from(JSON.stringify({ sid, exp: Math.floor(Date.now() / 1000) + 60, act, own }), "utf8");
  const mac = createHmac("sha256", secret).update(payload).digest();
  return `${payload.toString("base64url")}.${mac.toString("base64url")}`;
}
```

Test vectors (also asserted in `test.mjs` and `sandbox-token.test.ts`):

```
secret   0123456789abcdef0123456789abcdef
payload  {"sid":"123e4567-e89b-42d3-a456-426614174000","exp":1800000000,"act":"run"}
token    eyJzaWQiOiIxMjNlNDU2Ny1lODliLTQyZDMtYTQ1Ni00MjY2MTQxNzQwMDAiLCJleHAiOjE4MDAwMDAwMDAsImFjdCI6InJ1biJ9.x4d1b-3_LfP2u9e6oBe0EiThcaQkgAljs49d_G9LxTU

payload  {"sid":"123e4567-e89b-42d3-a456-426614174000","exp":1800000000,"act":"run","own":"b3duZXItdGFnLWV4YW1wbGU"}
token    eyJzaWQiOiIxMjNlNDU2Ny1lODliLTQyZDMtYTQ1Ni00MjY2MTQxNzQwMDAiLCJleHAiOjE4MDAwMDAwMDAsImFjdCI6InJ1biIsIm93biI6ImIzZHVaWEl0ZEdGbkxXVjRZVzF3YkdVIn0.7XEN7OKKp6e9YdWJohcCNJSW9X1jWfsidZXDyfOBbR0
```

The payload has no spaces and its keys are in the order `sid`, `exp`, `act`, `own` (what `JSON.stringify` gives for that object literal). The verifier accepts any JSON layout, since the MAC covers the bytes sent; the vector only matches with this one.

## API

JSON in and out. `:sid` is the Session id, a lower-case UUID. Every response has `Cache-Control: no-store`.

### `GET /health` (no token)

`200 { "ok": true }`. `ok` is false when Docker is down or the Runner is shutting down. Nothing else, since anyone can ask.

### `GET /status` (act `status`, `sid` "")

`200 { "ok": true, "docker": true, "live": 2, "max": 6, "maxPerOwner": 2, "runtime": "runsc" }`. `live` is the number of Sandboxes; `runtime` is `RUNNER_RUNTIME`, or `runc` when unset.

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

- `exitCode` is the command's own. `124` with `timedOut: true` when it hit the timeout. `137` when it was killed (out of memory, or output far beyond the cap). `127` or `126` when the program does not exist or cannot be executed; Docker's message is then in `stdout`. On `126` the Runner adds a line to `stderr` saying that `/work` and `/tmp` are `noexec` and to run the file through its interpreter.
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
| 403 | `forbidden` | Signed correctly, but for another Session or another action, or a `write`/`run` token with no Owner tag. |
| 404 | `not_found` | No such route. |
| 404 | `file_not_found` | `read` only. |
| 405 | `method_not_allowed` | With an `Allow` header. |
| 409 | `path_conflict` | `write`: the path is a directory, a link or a special file, or a parent is a file. |
| 409 | `too_many_files` | `write`: the Sandbox already holds 200 files. |
| 413 | `body_too_large` | The body is over 512 KB. |
| 413 | `file_too_large` | `content` is over 256 KB. |
| 429 | `rate_limited` | Too many requests. `Retry-After` in seconds. |
| 429 | `session_busy` | The Session already has 4 requests running or waiting. |
| 429 | `owner_at_capacity` | `write`/`run` would start a Sandbox, and this Owner already has `RUNNER_MAX_PER_OWNER` live. `Retry-After: 60`. |
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
RUNNER_RUNTIME=runsc node --test sandbox-runner/test.mjs     # with gVisor
RUNNER_ALLOW_RUNC=1 node --test sandbox-runner/test.mjs      # on runc (a development machine)
```

The unit tests, and the ones against a fake `docker` (flags passed, the per-Owner cap), need nothing. The integration tests start real Runners on random ports and real containers, and are skipped when Docker is not available or when neither variable above is set. They take about a minute, use their own `RUNNER_INSTANCE`, and remove every container they start. They leave the image `harness-sandbox:1` and its base `python:3.13-alpine` in place.

Check that nothing is left: `docker ps -a --filter label=harness.sandbox=1`.
