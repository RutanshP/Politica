#!/bin/bash
#
# Refreshes state bills + committees -- the data scope=people (sync-states.sh) skips to stay
# inside OpenStates' 10 req/min limit. This is the expensive half: a per-bill and per-committee
# detail fetch for every item, so it's meant for its own, slower cadence, separate from the daily
# legislator sync. How much slower depends on how long a run actually takes on your machine --
# time it once before wiring up a recurring schedule.
#
# It is self-contained: it boots the app on its own port, syncs, and shuts the server down again.
#
#   ./scripts/sync-state-detail.sh            # the default state list (see POLITICA_OPENSTATES_STATE_CODES)
#   ./scripts/sync-state-detail.sh tx ca      # specific states only
#
set -uo pipefail

# cron runs with a minimal PATH (/usr/bin:/bin) that lacks Homebrew node/npx.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

PORT="${SYNC_PORT:-3996}"
LOG_DIR="$REPO/logs"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [ ! -f .env.local ]; then
  log "FATAL: .env.local not found"
  exit 1
fi
set -a; . ./.env.local; set +a

if [ -z "${POLITICA_SYNC_SECRET:-}" ]; then
  log "FATAL: POLITICA_SYNC_SECRET is not set"
  exit 1
fi

STATES=("$@")

# --- boot the app -----------------------------------------------------------
if [ ! -d .next ]; then
  log "No build found; building..."
  npx next build > "$LOG_DIR/build.log" 2>&1 || { log "FATAL: build failed (see logs/build.log)"; exit 1; }
fi

npx next start -p "$PORT" > "$LOG_DIR/sync-server.log" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://localhost:$PORT/elections" && break
  sleep 1
done
curl -sf -o /dev/null "http://localhost:$PORT/elections" || { log "FATAL: server did not start on :$PORT"; exit 1; }
log "Server up on :$PORT (pid $SERVER_PID)"

BASE="http://localhost:$PORT"
AUTH="Authorization: Bearer $POLITICA_SYNC_SECRET"

quota_exhausted() { grep -qi "daily quota" <<< "$1"; }

STATES_QUERY=""
if [ "${#STATES[@]}" -gt 0 ]; then
  JOINED=$(IFS=,; echo "${STATES[*]}")
  STATES_QUERY="&states=$JOINED"
  log "States this run: ${STATES[*]}"
else
  log "States this run: default list"
fi

START=$(date +%s)
RESP=$(curl -s -X POST -H "$AUTH" --max-time 3000 \
  "$BASE/api/internal/sync/state-legislation?scope=detail${STATES_QUERY}")
ELAPSED=$(( $(date +%s) - START ))

if quota_exhausted "$RESP"; then
  log "OpenStates daily quota exhausted after ${ELAPSED}s."
  exit 0
fi

log "Done in ${ELAPSED}s."
log "Response: $(echo "$RESP" | head -c 2000)"
