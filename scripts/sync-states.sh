#!/bin/bash
#
# Drains the state backfill queue, a few states per run.
#
# OpenStates' free key allows 250 requests/day and a state costs ~35 (members + roll calls), so
# the whole country does not fit in one day. This script processes STATES_PER_RUN states, removes
# each one from the queue only once it succeeds, and stops immediately when the daily quota is
# exhausted -- so the next run picks up exactly where this one left off.
#
# It is self-contained: it boots the app on its own port, syncs, and shuts the server down again.
#
#   ./scripts/sync-states.sh            # take the next STATES_PER_RUN states off the queue
#   ./scripts/sync-states.sh tx ca      # sync these states explicitly, ignoring the queue
#
set -uo pipefail

# cron runs with a minimal PATH (/usr/bin:/bin) that lacks Homebrew node/npx.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

PORT="${SYNC_PORT:-3996}"
STATES_PER_RUN="${STATES_PER_RUN:-3}"
QUEUE="$REPO/scripts/state-sync-queue.txt"
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

# Which states to do this run: explicit args, else the head of the queue.
# (macOS ships bash 3.2, which has no `mapfile`, so read the queue the portable way.)
STATES=()
if [ "$#" -gt 0 ]; then
  STATES=("$@")
else
  if [ ! -s "$QUEUE" ]; then
    log "Queue is empty -- every state is synced. Nothing to do."
    exit 0
  fi
  while IFS= read -r line; do
    [ -n "$line" ] && STATES+=("$line")
  done < <(grep -vE '^[[:space:]]*(#|$)' "$QUEUE" | head -n "$STATES_PER_RUN")
fi

if [ "${#STATES[@]}" -eq 0 ]; then
  log "Nothing queued."
  exit 0
fi

log "States this run: ${STATES[*]}"

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

# A daily-quota 429 is not retriable: stop the whole run and leave the queue intact.
quota_exhausted() { grep -qi "daily quota" <<< "$1"; }

for STATE in "${STATES[@]}"; do
  log "[$STATE] legislators..."
  RESP=$(curl -s -X POST -H "$AUTH" --max-time 2400 \
    "$BASE/api/internal/sync/state-legislation?states=$STATE&scope=people")
  if quota_exhausted "$RESP"; then
    log "[$STATE] OpenStates daily quota exhausted. Stopping; queue left intact for the next run."
    exit 0
  fi
  log "[$STATE] legislators: $(python3 -c 'import json,sys;d=json.load(sys.stdin);m=d.get("metadata") or d;print(m.get("status"),"records=",m.get("recordCount"))' <<< "$RESP" 2>/dev/null || echo "unparseable")"

  log "[$STATE] roll calls..."
  RESP=$(curl -s -X POST -H "$AUTH" --max-time 2400 "$BASE/api/internal/sync/state-votes?states=$STATE")
  if quota_exhausted "$RESP"; then
    log "[$STATE] OpenStates daily quota exhausted mid-state. Stopping; queue left intact."
    exit 0
  fi
  log "[$STATE] roll calls: $(python3 -c '
import json,sys
d=json.load(sys.stdin)
if not d.get("ok"): print("ERROR", str(d.get("error"))[:80])
else:
    r=d["results"][0]
    print(f"votes={r[\"votesImported\"]} matched={r[\"positionsMatched\"]} unmatched={r[\"positionsUnmatched\"]} members={r[\"politiciansUpdated\"]}")
' <<< "$RESP" 2>/dev/null || echo "unparseable")"

  # Only drop the state from the queue once it actually completed.
  if [ -f "$QUEUE" ]; then
    grep -viE "^\s*$STATE\s*$" "$QUEUE" > "$QUEUE.tmp" && mv "$QUEUE.tmp" "$QUEUE"
    log "[$STATE] done; removed from queue ($(grep -cvE '^\s*(#|$)' "$QUEUE" 2>/dev/null || echo 0) left)"
  fi
done

log "Run complete."
