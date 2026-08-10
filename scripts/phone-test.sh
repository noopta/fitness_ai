#!/usr/bin/env bash
#
# Bring up the whole stack for testing on a real phone, and print one URL.
#
# Starts the branch backend, the Vite client, and two cloudflared quick tunnels,
# wires the CORS origin and API base between them, mints a short-lived token,
# and prints a link you can open on a phone. Ctrl-C tears all of it down.
#
# Why tunnels: iOS Safari only exposes geolocation over HTTPS, so localhost or a
# LAN IP will not do. Quick tunnels give a real HTTPS origin with no DNS setup.
#
# The tunnel hostnames are RANDOM PER RUN — that is inherent to quick tunnels,
# so the URL from a previous run is always dead. Re-run this to get a new one.
#
# Runs against backend/prisma/dev.db. Seed it from prod with:
#   cp /home/ubuntu/fitness_ai_repo/backend/prisma/dev.db backend/prisma/dev.db
# so you get real accounts and real meal history without touching production.
#
#   ./scripts/phone-test.sh
#   ./scripts/phone-test.sh --email me@example.com
#   API_PORT=3099 WEB_PORT=5000 ./scripts/phone-test.sh

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-3099}"
WEB_PORT="${WEB_PORT:-5000}"
RUN="$(mktemp -d)"
PIDS=()

cleanup() {
  echo ""
  echo "Shutting down…"
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  # cloudflared spawns children that outlive a plain kill on the parent.
  pkill -P $$ 2>/dev/null || true
  rm -rf "$RUN"
}
trap cleanup EXIT INT TERM

need() { command -v "$1" >/dev/null || { echo "Missing required command: $1"; exit 1; }; }
need cloudflared
need npx

[ -f "$REPO/backend/.env" ] || { echo "backend/.env not found."; exit 1; }
[ -f "$REPO/backend/prisma/dev.db" ] || {
  echo "backend/prisma/dev.db not found. Seed it first:"
  echo "  cp /home/ubuntu/fitness_ai_repo/backend/prisma/dev.db $REPO/backend/prisma/dev.db"
  exit 1
}

# Wait for a cloudflared log to reveal its assigned hostname.
tunnel_url() {
  local log="$1" url=""
  for _ in $(seq 1 60); do
    url="$(grep -oh 'https://[a-z0-9-]*\.trycloudflare\.com' "$log" 2>/dev/null | head -1 || true)"
    [ -n "$url" ] && { echo "$url"; return 0; }
    sleep 1
  done
  echo "Timed out waiting for a tunnel hostname. Last output:" >&2
  tail -5 "$log" >&2
  return 1
}

wait_http() {
  local url="$1" want="$2"
  for _ in $(seq 1 90); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null)" = "$want" ] && return 0
    sleep 2
  done
  return 1
}

# Tunnels first: the backend needs the web origin for CORS and the client needs
# the backend origin for its API base, so both hostnames must exist up front.
echo "Starting tunnels…"
cloudflared tunnel --url "http://localhost:$API_PORT" --no-autoupdate > "$RUN/api.log" 2>&1 &
PIDS+=($!)
cloudflared tunnel --url "http://localhost:$WEB_PORT" --no-autoupdate > "$RUN/web.log" 2>&1 &
PIDS+=($!)

API_URL="$(tunnel_url "$RUN/api.log")"
WEB_URL="$(tunnel_url "$RUN/web.log")"
echo "  api → $API_URL"
echo "  web → $WEB_URL"

echo "Starting backend on :$API_PORT…"
(
  cd "$REPO/backend"
  set -a; . ./.env; set +a
  PORT="$API_PORT" \
  DATABASE_URL="file:./dev.db" \
  GCP_PLACES_PROJECT="${GCP_PLACES_PROJECT:-sinuous-concept-497821-s5}" \
  EXTRA_ALLOWED_ORIGINS="$WEB_URL" \
  exec npx tsx src/index.ts
) > "$RUN/backend.log" 2>&1 &
PIDS+=($!)

# 401 is the healthy answer here: the route exists and auth is enforced.
if ! wait_http "http://localhost:$API_PORT/api/nutrition-profile/food-finder" 401; then
  echo "Backend did not come up:"; tail -20 "$RUN/backend.log"; exit 1
fi
echo "  backend up"

echo "Starting web client on :$WEB_PORT…"
(
  cd "$REPO/frontend-v2"
  VITE_API_URL="$API_URL/api" exec npx vite dev --port "$WEB_PORT" --host 0.0.0.0
) > "$RUN/web-client.log" 2>&1 &
PIDS+=($!)

if ! wait_http "http://localhost:$WEB_PORT/food-finder" 200; then
  echo "Vite did not come up:"; tail -20 "$RUN/web-client.log"
  echo "If it cannot resolve 'vite', this worktree is missing frontend-v2/node_modules."
  exit 1
fi
echo "  web up"

TOKEN="$(cd "$REPO/backend" && set -a && . ./.env && set +a && npx tsx scripts/mintDevToken.ts --quiet "$@")"
[ -n "$TOKEN" ] || { echo "Failed to mint a token."; exit 1; }

cat <<BANNER

──────────────────────────────────────────────────────────────
Open this on your phone:

$WEB_URL/food-finder?token=$TOKEN

Tap "Use my location" for real GPS, or "Skip" to check the
no-location fallback. The token expires in 12h and only works
against this run's tunnel.

Logs: $RUN
Ctrl-C to stop everything.
──────────────────────────────────────────────────────────────

BANNER

wait
