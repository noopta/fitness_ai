#!/usr/bin/env bash
# Deploy script — runs on EC2 over SSH from the GitHub Actions deploy
# workflow. Idempotent: safe to run multiple times in a row. Exits non-zero
# on any failure so the GitHub Action surfaces the error in its log.
#
# Order of operations is deliberate:
#   1. Pull main FIRST so a partial pull never gets restarted.
#   2. npm ci so a removed/added package can't leave a stale node_modules.
#   3. prisma generate so any schema changes regenerate the client.
#   4. Build BEFORE restart — if build fails we keep the old process alive.
#   5. systemctl restart last; only happens when everything else succeeded.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/ubuntu/fitness_ai_repo}"
BRANCH="${DEPLOY_BRANCH:-main}"

cd "$REPO_DIR"

echo "── 1/5 git fetch + reset to origin/$BRANCH"
git fetch --quiet origin "$BRANCH"
git reset --hard "origin/$BRANCH"

cd "$REPO_DIR/backend"

echo "── 2/5 npm ci (backend)"
npm ci --omit=dev=false --no-audit --no-fund

echo "── 3/5 prisma generate"
npx prisma generate

echo "── 4/5 build"
npm run build

echo "── 5/5 systemctl restart fitness-ai.service"
sudo -n systemctl restart fitness-ai.service

# Quick smoke — does the service actually come back up?
sleep 2
if ! systemctl is-active --quiet fitness-ai.service; then
  echo "ERROR: fitness-ai.service failed to start after restart"
  sudo -n journalctl -u fitness-ai.service -n 30 --no-pager
  exit 1
fi

echo "✓ deploy complete — $(date -u +%FT%TZ)"
