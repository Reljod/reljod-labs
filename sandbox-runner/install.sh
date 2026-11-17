#!/usr/bin/env bash
# Installs the Harness Sandbox Runner on this machine. Run by the owner, as root:
#
#   sudo ./install.sh [hostname]          e.g. sudo ./install.sh sandbox.example.com
#
# Optional environment: NODE_BIN (path to a system-wide Node 22+, default: node
# on root's PATH), RUNNER_PORT (only used when the env file is first written, default 8787).
#
# Isolation: it looks for gVisor (`runsc`) among Docker's runtimes and, if it is
# there, sets RUNNER_RUNTIME=runsc. If it is not, it stops and spells out the
# two choices (install gVisor, recommended; or accept runc by writing
# RUNNER_ALLOW_RUNC=1 into the env file yourself). It never sets
# RUNNER_ALLOW_RUNC on its own. See README.md, "Isolation".
#
# Safe to run again: it updates the files, the image and the unit, keeps the
# existing secret, and restarts the service.
#
# What it does:
#   0. checks for gVisor (see above); stops here if it is missing and runc was not accepted
#   1. creates the system user `harness-runner` and adds it to the `docker` group
#   2. copies the Runner to /opt/harness-sandbox (root-owned, read-only to the service)
#   3. builds the Sandbox image harness-sandbox:1
#   4. writes /etc/harness-sandbox/runner.env (0600 root) with a generated RUNNER_SECRET,
#      unless the file already has one. The secret is never printed.
#   5. writes /etc/systemd/system/harness-sandbox.slice (all Sandboxes together:
#      CPUQuota=200%, MemoryMax=2G) and sets RUNNER_CGROUP_PARENT to it
#   6. writes /etc/systemd/system/harness-sandbox.service, enables and (re)starts it
#   7. prints the Caddy site block to add. It does not touch Caddy, DNS or the firewall.
#
# Why a dedicated user and not yours: the service needs the Docker socket and
# nothing else of yours (no home directory, no SSH keys, no other secrets).
# Note that membership of the docker group is root-equivalent on this host;
# that is inherent in a service that starts containers.

set -euo pipefail
umask 022

RUNNER_USER="harness-runner"
INSTALL_DIR="/opt/harness-sandbox"
ENV_DIR="/etc/harness-sandbox"
ENV_FILE="${ENV_DIR}/runner.env"
UNIT_FILE="/etc/systemd/system/harness-sandbox.service"
SLICE_NAME="harness-sandbox.slice"
SLICE_FILE="/etc/systemd/system/${SLICE_NAME}"
IMAGE="harness-sandbox:1"
SITE_HOSTNAME="${1:-sandbox.example.com}"
DEFAULT_PORT="8787"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() {
  echo "install.sh: $*" >&2
  exit 1
}
step() { echo "==> $*"; }

[ "${EUID}" -eq 0 ] || die "run as root: sudo $0 [hostname]"
[[ "${SITE_HOSTNAME}" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$ ]] || die "not a hostname: ${SITE_HOSTNAME}"
for tool in docker openssl systemctl useradd install sed; do
  command -v "${tool}" >/dev/null 2>&1 || die "${tool} is required and was not found"
done
getent group docker >/dev/null || die "the docker group does not exist"
for file in runner.mjs token.mjs validate.mjs Dockerfile README.md harness-sandbox.service Caddyfile.snippet; do
  [ -f "${SRC}/${file}" ] || die "missing ${SRC}/${file}"
done

# The service cannot read home directories (ProtectHome), so Node must be a
# system-wide one. Under sudo, PATH normally finds /usr/bin/node; override
# with NODE_BIN=/path/to/node if needed.
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
[ -n "${NODE_BIN}" ] && [ -x "${NODE_BIN}" ] || die "node was not found; install Node 22+ system-wide or pass NODE_BIN=/path/to/node"
NODE_BIN="$(readlink -f "${NODE_BIN}")"
case "${NODE_BIN}" in
/home/* | /root/*) die "node is at ${NODE_BIN}, inside a home directory the service cannot read. Use a system-wide Node (e.g. NODE_BIN=/usr/bin/node)." ;;
esac
NODE_MAJOR="$("${NODE_BIN}" -p 'process.versions.node.split(".")[0]')"
[ "${NODE_MAJOR}" -ge 22 ] || die "Node 22 or newer is required, found $("${NODE_BIN}" --version)"

step "Container runtime"
RUNTIMES="$(docker info --format '{{json .Runtimes}}' 2>/dev/null || true)"
[ -n "${RUNTIMES}" ] || die "docker info did not answer; is the Docker daemon running?"
RUNTIME=""
if printf '%s' "${RUNTIMES}" | grep -q '"runsc"'; then
  RUNTIME="runsc"
  echo "    gVisor (runsc) is registered with Docker: Sandboxes will run on it"
elif [ -f "${ENV_FILE}" ] && grep -qx 'RUNNER_ALLOW_RUNC=1' "${ENV_FILE}"; then
  echo "    no gVisor; ${ENV_FILE} has RUNNER_ALLOW_RUNC=1, so Sandboxes run on runc (risk accepted by the owner)"
else
  cat >&2 <<STOP
install.sh: stopping. gVisor (runsc) is not registered with Docker on this machine.

Without it, Sandboxes run on runc, which shares this machine's kernel with
code any visitor can send. A kernel bug reachable from inside a container
would put that code on this host, next to everything else here: other
services' files and tokens, every home directory, and the Docker socket
(root on this host). Choose one:

  1. Recommended: install gVisor, then run this script again
     (commands from https://gvisor.dev/docs/user_guide/install/ ; README.md, "Isolation"):

       sudo apt-get update && sudo apt-get install -y apt-transport-https ca-certificates curl gnupg
       curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
       echo "deb [arch=\$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list > /dev/null
       sudo apt-get update && sudo apt-get install -y runsc
       sudo runsc install
       sudo systemctl restart docker
       docker info --format '{{json .Runtimes}}'     # must list "runsc"
       docker run --runtime=runsc --rm hello-world

  2. Accept the risk on runc, knowingly: as root, put the line
       RUNNER_ALLOW_RUNC=1
     into ${ENV_FILE} (mode 0600, owned by root; create it if needed), then
     run this script again. Do this only on a machine that holds nothing you
     would mind a stranger reading or using.
STOP
  exit 1
fi
CGROUP_DRIVER="$(docker info --format '{{.CgroupDriver}}' 2>/dev/null || true)"
if [ "${CGROUP_DRIVER}" != "systemd" ]; then
  echo "    warning: Docker's cgroup driver is '${CGROUP_DRIVER}', not systemd; the caps of ${SLICE_NAME} may not apply" >&2
fi

step "User ${RUNNER_USER} (member of docker)"
if ! id -u "${RUNNER_USER}" >/dev/null 2>&1; then
  useradd --system --user-group --no-create-home --home-dir /var/lib/harness-sandbox \
    --shell /usr/sbin/nologin "${RUNNER_USER}"
fi
usermod --append --groups docker "${RUNNER_USER}"

step "Runner files in ${INSTALL_DIR}"
install -d -m 0755 -o root -g root "${INSTALL_DIR}"
install -m 0644 -o root -g root \
  "${SRC}/runner.mjs" "${SRC}/token.mjs" "${SRC}/validate.mjs" "${SRC}/Dockerfile" "${SRC}/README.md" \
  "${INSTALL_DIR}/"

step "Sandbox image ${IMAGE}"
docker build --quiet --tag "${IMAGE}" "${INSTALL_DIR}" >/dev/null

step "Environment file ${ENV_FILE}"
install -d -m 0700 -o root -g root "${ENV_DIR}"
if [ ! -f "${ENV_FILE}" ]; then
  (
    umask 077
    {
      echo "# Harness Sandbox Runner. Read by systemd as root; keep it 0600."
      echo "RUNNER_PORT=${RUNNER_PORT:-${DEFAULT_PORT}}"
      echo "RUNNER_MAX_SANDBOXES=6"
      echo "RUNNER_MAX_PER_OWNER=2"
      echo "RUNNER_IDLE_MINUTES=15"
    } >"${ENV_FILE}"
  )
fi
if ! grep -q '^RUNNER_SECRET=.\{32,\}' "${ENV_FILE}"; then
  # Written straight into the file; never echoed to the terminal or the journal.
  (
    umask 077
    sed -i '/^RUNNER_SECRET=/d' "${ENV_FILE}"
    printf 'RUNNER_SECRET=%s\n' "$(openssl rand -hex 32)" >>"${ENV_FILE}"
  )
  echo "    generated a new RUNNER_SECRET (not shown)"
else
  echo "    kept the existing RUNNER_SECRET"
fi
# Settings this script owns, rewritten on every run. RUNNER_ALLOW_RUNC is not
# one of them: only the owner writes it.
set_var() {
  sed -i "/^$1=/d" "${ENV_FILE}"
  printf '%s=%s\n' "$1" "$2" >>"${ENV_FILE}"
}
if [ -n "${RUNTIME}" ]; then
  set_var RUNNER_RUNTIME "${RUNTIME}"
else
  sed -i '/^RUNNER_RUNTIME=/d' "${ENV_FILE}"
fi
set_var RUNNER_CGROUP_PARENT "${SLICE_NAME}"
chown root:root "${ENV_FILE}"
chmod 0600 "${ENV_FILE}"
PORT="$(sed -n 's/^RUNNER_PORT=\([0-9]\{1,5\}\)$/\1/p' "${ENV_FILE}" | tail -n 1)"
PORT="${PORT:-${DEFAULT_PORT}}"

step "systemd slice ${SLICE_FILE} (all Sandboxes together: 2 CPUs, 2 GB)"
cat >"${SLICE_FILE}" <<SLICE
# Written by sandbox-runner/install.sh. Every Sandbox container is started
# under this slice (RUNNER_CGROUP_PARENT), so together they never take more
# than two CPUs and 2 GB of memory, however many are busy.
[Unit]
Description=Harness Sandboxes (all containers of the Sandbox Runner)
Before=slices.target

[Slice]
CPUAccounting=yes
CPUQuota=200%
MemoryAccounting=yes
MemoryMax=2G
SLICE
chmod 0644 "${SLICE_FILE}"

step "systemd unit ${UNIT_FILE}"
RENDERED="$(mktemp)"
trap 'rm -f "${RENDERED}"' EXIT
sed -e "s|@NODE@|${NODE_BIN}|g" \
  -e "s|@INSTALL_DIR@|${INSTALL_DIR}|g" \
  -e "s|@USER@|${RUNNER_USER}|g" \
  -e "s|@ENV_FILE@|${ENV_FILE}|g" \
  "${SRC}/harness-sandbox.service" >"${RENDERED}"
if grep -q '@[A-Z_]*@' "${RENDERED}"; then die "the unit template has a placeholder this script does not fill"; fi
install -m 0644 -o root -g root "${RENDERED}" "${UNIT_FILE}"
systemctl daemon-reload
systemctl start "${SLICE_NAME}"
systemctl enable harness-sandbox.service >/dev/null
systemctl restart harness-sandbox.service

step "Health check on 127.0.0.1:${PORT}"
healthy=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if "${NODE_BIN}" -e '
    fetch("http://127.0.0.1:" + process.argv[1] + "/health")
      .then((r) => r.json())
      .then((j) => { console.log("    " + JSON.stringify(j)); process.exit(j.ok ? 0 : 1); })
      .catch(() => process.exit(1));
  ' "${PORT}" 2>/dev/null; then
    healthy="yes"
    break
  fi
  sleep 1
done
[ -n "${healthy}" ] || die "the Runner is not healthy. Look at: journalctl -u harness-sandbox -n 50"

cat <<EOF

The Runner is running on 127.0.0.1:${PORT}. Three things are left, by hand:

1. DNS: point ${SITE_HOSTNAME} (A/AAAA) at this machine.

2. Caddy: add this site to your Caddyfile, then  sudo systemctl reload caddy

EOF
sed -n '/^[^#[:space:]].*{$/,$p' "${SRC}/Caddyfile.snippet" |
  sed -e "s|sandbox\.example\.com|${SITE_HOSTNAME}|" -e "s|127\.0\.0\.1:8787|127.0.0.1:${PORT}|"
cat <<EOF

3. Vercel: give the app the URL and the same secret, without printing the secret:

     vercel env add HARNESS_SANDBOX_URL production      # value: https://${SITE_HOSTNAME}
     sudo sed -n 's/^RUNNER_SECRET=//p' ${ENV_FILE} | tr -d '\n' | vercel env add HARNESS_SANDBOX_SECRET production

   To rotate the secret: delete the RUNNER_SECRET line from ${ENV_FILE},
   run this script again, and repeat step 3.

Logs:      journalctl -u harness-sandbox -f
Sandboxes: docker ps --filter label=harness.sandbox=1
Runtimes:  docker info --format '{{json .Runtimes}}'    (runsc expected)
Remove:    systemctl disable --now harness-sandbox && rm ${UNIT_FILE} ${SLICE_FILE} && systemctl daemon-reload
EOF
