#!/usr/bin/env bash
# Installs or updates Openpals on a fresh Ubuntu or Debian server and runs it as the openpals systemd service.
#
#   curl -fsSL https://raw.githubusercontent.com/borjasolerme/Openpals/main/scripts/install-server.sh \
#     | bash -s -- [--public-url https://bots.example.com] [--label "My server"]
#
# Without --public-url it serves https://<public-ip>.sslip.io through Caddy. Safe to run again: it updates the code,
# rebuilds, restarts the service and prints a new pairing link. The Openpals app reads the OPENPALS_PAIRING_LINK= line.
set -euo pipefail

REPO_URL="https://github.com/borjasolerme/Openpals.git"
INSTALL_DIR="${HOME}/Openpals"
PORT=8799
NODE_MAJOR=24
PNPM_VERSION="10.33.0"
SERVICE_NAME="openpals"
SWAP_FILE="/swapfile"
SWAP_SIZE="4G"
MIN_MEMORY_KB=$((6 * 1024 * 1024))
CADDYFILE="/etc/caddy/Caddyfile"
CADDY_MARKER="# Managed by the Openpals installer"

public_url=""
self_served=0
label="$(hostname 2>/dev/null || echo "Openpals server")"

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nError: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Install Openpals on this server and keep it running.

  install-server.sh [--public-url https://bots.example.com] [--label "My server"]

--public-url  the HTTPS address that reaches port 8799 on this server. Without it, the installer
              sets up Caddy with a free https://<public-ip>.sslip.io address (ports 80 and 443 must be open)
--label       the name the Openpals app shows for this server (default: the hostname)
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --public-url) [ $# -ge 2 ] || fail "--public-url needs an address"; public_url="${2%/}"; shift 2 ;;
      --label) [ $# -ge 2 ] || fail "--label needs a name"; label="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; fail "unknown option: $1" ;;
    esac
  done
  if [ -n "$public_url" ]; then
    [[ "$public_url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] \
      || fail "--public-url must be an HTTPS address with no path, like https://bots.example.com"
  fi
  [[ "$label" =~ ^[A-Za-z0-9][A-Za-z0-9\ ._-]{0,59}$ ]] \
    || fail "--label may use letters, numbers, spaces, dots, dashes and underscores (up to 60)"
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

check_system() {
  [ "$(uname -s)" = "Linux" ] || fail "this installer runs on a Linux server"
  command -v apt-get >/dev/null 2>&1 || fail "this installer needs Ubuntu or Debian (apt-get was not found)"
  command -v systemctl >/dev/null 2>&1 || fail "this installer needs systemd"
  if [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null 2>&1 || fail "run this as root, or as a user who can use sudo"
    sudo -n true 2>/dev/null || { : </dev/tty; } 2>/dev/null \
      || fail "run this as root, or as a user who can use sudo without a password"
  fi
}

install_packages() {
  say "Installing git and curl"
  as_root apt-get update -y
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git
}

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

install_node() {
  if [ "$(node_major)" -ge "$NODE_MAJOR" ]; then
    say "Node $(node --version) is already installed"
    return
  fi
  say "Installing Node ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | as_root bash -
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  [ "$(node_major)" -ge "$NODE_MAJOR" ] || fail "Node ${NODE_MAJOR} could not be installed"
}

ensure_corepack() {
  command -v corepack >/dev/null 2>&1 || as_root npm install --global corepack
}

get_code() {
  if [ -d "${INSTALL_DIR}/.git" ]; then
    say "Updating Openpals in ${INSTALL_DIR}"
    git -C "$INSTALL_DIR" pull --ff-only
  elif [ -e "$INSTALL_DIR" ]; then
    fail "${INSTALL_DIR} exists but is not an Openpals checkout; move it away and run this again"
  else
    say "Downloading Openpals into ${INSTALL_DIR}"
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi
}

ensure_swap() {
  local memory_kb
  memory_kb="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
  [ "$memory_kb" -lt "$MIN_MEMORY_KB" ] || return 0
  if as_root swapon --show=NAME --noheadings | grep -qx "$SWAP_FILE"; then return 0; fi
  say "Adding ${SWAP_SIZE} of swap so the build fits in memory"
  if [ ! -f "$SWAP_FILE" ]; then
    as_root fallocate -l "$SWAP_SIZE" "$SWAP_FILE" || as_root dd if=/dev/zero of="$SWAP_FILE" bs=1M count=4096
    as_root chmod 600 "$SWAP_FILE"
    as_root mkswap "$SWAP_FILE"
  fi
  as_root swapon "$SWAP_FILE"
  grep -q "^${SWAP_FILE} " /etc/fstab || echo "${SWAP_FILE} none swap sw 0 0" | as_root tee -a /etc/fstab >/dev/null
}

build() {
  say "Installing dependencies (a few minutes)"
  cd "$INSTALL_DIR"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 ELECTRON_SKIP_BINARY_DOWNLOAD=1
  corepack "pnpm@${PNPM_VERSION}" install --frozen-lockfile
  say "Building the web app"
  corepack "pnpm@${PNPM_VERSION}" exec vite build
}

public_ipv4() {
  local ip
  ip="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
  [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || ip="$(ip -4 route get 1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1) }')"
  [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "could not find this server's public IPv4 address; pass --public-url instead"
  printf '%s' "$ip"
}

install_caddy() {
  if command -v caddy >/dev/null 2>&1; then return 0; fi
  say "Installing Caddy for HTTPS"
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y gnupg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | as_root gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  as_root chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    | as_root tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  as_root chmod o+r /etc/apt/sources.list.d/caddy-stable.list
  as_root apt-get update -y
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
}

serve_https() {
  local host="$1" config
  if [ -f "$CADDYFILE" ] && ! grep -qF "$CADDY_MARKER" "$CADDYFILE" && ! grep -q '/usr/share/caddy' "$CADDYFILE"; then
    fail "${CADDYFILE} already holds your own settings; add ${host} there yourself and pass --public-url https://${host}"
  fi
  say "Serving https://${host}"
  config="$(mktemp)"
  printf '%s\n%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$CADDY_MARKER" "$host" "$PORT" >"$config"
  as_root install -m 644 "$config" "$CADDYFILE"
  rm -f "$config"
  if command -v ufw >/dev/null 2>&1 && as_root ufw status 2>/dev/null | grep -q "Status: active"; then
    as_root ufw allow 80,443/tcp >/dev/null
  fi
  as_root systemctl enable caddy >/dev/null 2>&1 || true
  as_root systemctl restart caddy
}

choose_public_url() {
  [ -z "$public_url" ] || return 0
  local ip
  ip="$(public_ipv4)"
  install_caddy
  serve_https "${ip//./-}.sslip.io"
  public_url="https://${ip//./-}.sslip.io"
  self_served=1
}

install_service() {
  say "Starting the ${SERVICE_NAME} service"
  local node_bin unit
  node_bin="$(command -v node)"
  unit="$(mktemp)"
  cat >"$unit" <<EOF
[Unit]
Description=Openpals
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=${INSTALL_DIR}
Environment=OMB_STATIC_DIR=${INSTALL_DIR}/dist
Environment=PATH=$(dirname "$node_bin"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=${node_bin} --experimental-strip-types server/openmausbot.ts serve --port ${PORT} --public-url ${public_url} --label "${label}" --no-pair
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  as_root install -m 644 "$unit" "/etc/systemd/system/${SERVICE_NAME}.service"
  rm -f "$unit"
  as_root systemctl daemon-reload
  as_root systemctl enable "${SERVICE_NAME}.service" >/dev/null
  as_root systemctl restart "${SERVICE_NAME}.service"
}

wait_until_running() {
  local tries=0
  until curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -lt 90 ] || fail "Openpals did not start. See its log with: sudo journalctl -u ${SERVICE_NAME} -n 100"
    sleep 2
  done
}

wait_for_certificate() {
  [ "$self_served" -eq 1 ] || return 0
  say "Waiting for the HTTPS certificate"
  local tries=0
  until curl -fsS --max-time 10 "${public_url}/api/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -lt 60 ] || fail "${public_url} did not get an HTTPS certificate. Ports 80 and 443 must be open to the internet (check your provider's firewall), then run this again. Caddy's log: sudo journalctl -u caddy -n 50"
    sleep 3
  done
}

print_pairing_link() {
  local pairing link
  say "Openpals is running at ${public_url}"
  cd "$INSTALL_DIR"
  pairing="$(node --experimental-strip-types server/openmausbot.ts pair --public-url "$public_url" --label "Openpals app")"
  printf '%s\n' "$pairing"
  link="$(grep -oE "https://[^[:space:]]+/pair#code=[^[:space:]]+" <<<"$pairing" | head -n 1 || true)"
  [ -n "$link" ] || fail "Openpals did not print a pairing link"
  printf 'OPENPALS_PAIRING_LINK=%s\n' "$link"
  cat <<EOF

Next: copy the pairing link above (it starts with ${public_url}/pair#code=)
and paste it into the Openpals app. It works once; run this installer again
for a new one.
EOF
}

main() {
  parse_args "$@"
  check_system
  install_packages
  install_node
  ensure_corepack
  get_code
  ensure_swap
  build
  choose_public_url
  install_service
  wait_until_running
  wait_for_certificate
  print_pairing_link
}

main "$@"
