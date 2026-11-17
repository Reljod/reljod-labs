#!/usr/bin/env bash
# Installs the Harness Sandbox Runner on this machine. Run by the owner, as root:
#
#   sudo ./install.sh [hostname]          e.g. sudo ./install.sh sandbox.example.com
#
# Optional environment: NODE_BIN (path to a system-wide Node 22+, default: node
# on root's PATH), RUNNER_PORT (only used when the env file is first written, default 8787).
#
# Safe to run again: it updates the files, the image and the unit, keeps the
# existing secret, and restarts the service.
#
# What it does:
#   1. creates the system user `harness-runner` and adds it to the `docker` group
#   2. copies the Runner to /opt/harness-sandbox (root-owned, read-only to the service)
#   3. builds the Sandbox image harness-sandbox:1
#   4. writes /etc/harness-sandbox/runner.env (0600 root) with a generated RUNNER_SECRET,
#      unless the file already has one. The secret is never printed.
#   5. writes /etc/systemd/system/harness-sandbox.service, enables and (re)starts it
#   6. prints the Caddy site block to add. It does not touch Caddy, DNS or the firewall.
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
chown root:root "${ENV_FILE}"
chmod 0600 "${ENV_FILE}"
PORT="$(sed -n 's/^RUNNER_PORT=\([0-9]\{1,5\}\)$/\1/p' "${ENV_FILE}" | tail -n 1)"
PORT="${PORT:-${DEFAULT_PORT}}"

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
Remove:    systemctl disable --now harness-sandbox && rm ${UNIT_FILE} && systemctl daemon-reload
EOF
