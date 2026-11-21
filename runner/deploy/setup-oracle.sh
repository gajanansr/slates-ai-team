#!/usr/bin/env bash
# Runs ON the Oracle VM (Ubuntu 22.04/24.04, ARM or x86). Safe to run again.
# Installs Docker, adds swap if there is none, and starts the runner with docker compose.
#
#   cd ~/slates-runner && bash deploy/setup-oracle.sh
#
# DRY_RUN=1 prints what it would do without changing anything.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SWAP_SIZE="${SWAP_SIZE:-2G}"

run() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo "+ $*"
  else
    "$@"
  fi
}
say() { printf '\n== %s\n' "$*"; }

if [[ "$(uname -s)" != "Linux" && "${DRY_RUN:-0}" != "1" ]]; then
  echo "This script is for the Linux VM. Use DRY_RUN=1 to preview it elsewhere." >&2
  exit 1
fi

say "1/5 Checking files in $APP_DIR"
for f in Dockerfile docker-compose.yml runner.mjs lib.mjs package.json package-lock.json; do
  [[ -f "$APP_DIR/$f" ]] || { echo "Missing $f. Copy the whole slates-runner folder first (deploy/push.sh does this)." >&2; exit 1; }
done
if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "No .env yet. Create it from .env.example and add your Slates token, then run this again." >&2
  exit 1
fi
run chmod 600 "$APP_DIR/.env"

say "2/5 Installing Docker (skipped if already there)"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "Docker and compose already installed: $(docker --version)"
else
  run sudo apt-get update -y
  # Ubuntu's own packages: no extra repositories needed.
  run sudo apt-get install -y docker.io docker-compose-v2
  run sudo systemctl enable --now docker
fi
if ! id -nG "$USER" | grep -qw docker; then
  run sudo usermod -aG docker "$USER"
  echo "Added $USER to the docker group (takes effect on next login; this run uses sudo)."
fi
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then DOCKER="sudo docker"; fi

say "3/5 Swap (the free ARM tier has little RAM)"
if [[ "$(swapon --show 2>/dev/null | wc -l)" -gt 0 ]]; then
  echo "Swap already on."
else
  run sudo fallocate -l "$SWAP_SIZE" /swapfile
  run sudo chmod 600 /swapfile
  run sudo mkswap /swapfile
  run sudo swapon /swapfile
  if ! grep -q '^/swapfile' /etc/fstab 2>/dev/null; then
    run sudo sh -c 'echo "/swapfile none swap sw 0 0" >> /etc/fstab'
  fi
fi

say "4/5 Building and starting the runner"
cd "$APP_DIR"
run $DOCKER compose up -d --build

say "5/5 Status"
run $DOCKER compose ps
echo
echo "Done. Useful commands (in $APP_DIR):"
echo "  logs:    $DOCKER compose logs -f runner"
echo "  restart: $DOCKER compose restart runner"
echo "  stop:    $DOCKER compose down"
if ! grep -q '^ANTHROPIC_API_KEY=.\+' "$APP_DIR/.env" 2>/dev/null; then
  echo
  echo "Claude still needs a login on this server (no ANTHROPIC_API_KEY in .env). Run once:"
  echo "  $DOCKER compose run --rm runner claude"
  echo "then type /login, finish in the browser, and /exit. The login is kept in a Docker volume."
fi
