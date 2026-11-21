#!/usr/bin/env bash
# Runs on YOUR Mac. Copies the runner to the Oracle VM and runs the setup there.
#
#   bash deploy/push.sh ubuntu@203.0.113.10 ~/.ssh/oracle_key
#
# The .env (with your tokens) is copied separately with owner-only permissions.
# DRY_RUN=1 prints the commands without running them.
set -euo pipefail

TARGET="${1:?usage: deploy/push.sh user@host [ssh-key-path]}"
KEY="${2:-}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_DIR="slates-runner"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[[ -n "$KEY" ]] && SSH_OPTS+=(-i "$KEY")

run() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo "+ $*"
  else
    "$@"
  fi
}

echo "== Copying code to $TARGET:~/$REMOTE_DIR"
run rsync -az --delete \
  --exclude node_modules --exclude work --exclude state.json --exclude .env --exclude .git \
  -e "ssh ${SSH_OPTS[*]}" \
  "$APP_DIR/" "$TARGET:$REMOTE_DIR/"

if [[ -f "$APP_DIR/.env" ]]; then
  echo "== Copying .env (owner-only)"
  run scp "${SSH_OPTS[@]}" "$APP_DIR/.env" "$TARGET:$REMOTE_DIR/.env"
  run ssh "${SSH_OPTS[@]}" "$TARGET" "chmod 600 ~/$REMOTE_DIR/.env"
else
  echo "== No local .env; create one on the server from .env.example before setup will continue."
fi
if [[ -f "$APP_DIR/agents.json" ]]; then
  run scp "${SSH_OPTS[@]}" "$APP_DIR/agents.json" "$TARGET:$REMOTE_DIR/agents.json"
fi

echo "== Running setup on the server"
run ssh -t "${SSH_OPTS[@]}" "$TARGET" "cd ~/$REMOTE_DIR && bash deploy/setup-oracle.sh"
