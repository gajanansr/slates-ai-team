#!/usr/bin/env bash
# Stage prop: push a realistic-looking bad commit to the demo site so the Slates watcher catches an outage.
# The commit moves the homepage into src/, so GitHub Pages serves a 404 at the site root.
set -euo pipefail
REPO="${1:-gajanansr/slates-oncall-demo}"
DIR="$(mktemp -d)"
gh repo clone "$REPO" "$DIR" -- -q
cd "$DIR"
# Personal identity for this personal repo (the clone lives outside ~/Documents/Gajanan, so the folder-scoped config does not apply).
git config user.name "Gajanan Rathod"
git config user.email "97657400+gajanansr@users.noreply.github.com"
mkdir -p src
git mv index.html src/index.html
git commit -q -m "Move homepage into src/ for the new build setup"
git push -q
echo "Pushed bad commit $(git rev-parse --short HEAD) to $REPO. The site goes down in ~30-60s."
