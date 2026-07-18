#!/bin/bash
#
# Backfills federal bill detail (actions, text versions, roll-call votes) in resumable chunks.
#
# The bill LIST is fully synced (17,862 bills), but per-bill detail requires ~3 Congress.gov calls
# each, so only a fraction has been detailed -- which is why most bills' Timeline/Text/Votes tabs
# are empty. Congress.gov allows 5,000 requests/hour, so this walks the list in offset chunks and
# records progress in a cursor file, resuming where it left off.
#
#   ./scripts/detail-federal-bills.sh          # process CHUNKS_PER_RUN chunks from the cursor
#   ./scripts/detail-federal-bills.sh 0         # restart from offset 0
#
set -uo pipefail

# cron runs with a minimal PATH (/usr/bin:/bin) that lacks Homebrew node/npx.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

PORT="${SYNC_PORT:-3995}"
CHUNK="${CHUNK:-100}"
CHUNKS_PER_RUN="${CHUNKS_PER_RUN:-8}"   # 8 x 100 = 800 bills/run
CURSOR="$REPO/scripts/.federal-detail-cursor"
LOG_DIR="$REPO/logs"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

set -a; . ./.env.local; set +a
[ -z "${POLITICA_SYNC_SECRET:-}" ] && { log "FATAL: POLITICA_SYNC_SECRET unset"; exit 1; }

# Total federal bills for the current Congress -> where to stop and wrap around.
TOTAL="${FEDERAL_BILL_TOTAL:-17862}"

OFFSET="${1:-$(cat "$CURSOR" 2>/dev/null || echo 0)}"
[ -z "$OFFSET" ] && OFFSET=0

[ ! -d .next ] && { log "Building..."; npx next build > "$LOG_DIR/build.log" 2>&1 || { log "build failed"; exit 1; }; }

npx next start -p "$PORT" > "$LOG_DIR/detail-server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$PORT/elections" && break; sleep 1; done
curl -sf -o /dev/null "http://localhost:$PORT/elections" || { log "server did not start"; exit 1; }

AUTH="Authorization: Bearer $POLITICA_SYNC_SECRET"
log "Detailing from offset $OFFSET ($CHUNKS_PER_RUN chunks of $CHUNK)"

for _ in $(seq 1 "$CHUNKS_PER_RUN"); do
  if [ "$OFFSET" -ge "$TOTAL" ]; then
    log "Reached end of list ($TOTAL); wrapping to 0."
    OFFSET=0
  fi

  RESP=$(curl -s -X POST -H "$AUTH" --max-time 2400 \
    "http://localhost:$PORT/api/internal/sync/legislation?mode=full&syncVotes=1&syncCommittees=1&offset=$OFFSET&limit=$CHUNK")
  STATUS=$(python3 -c "import json,sys;d=json.load(sys.stdin);m=d.get('metadata') or d;print(m.get('status'),'bills=',m.get('billsSynced'),'votes=',m.get('votesSynced'),str(m.get('error') or '')[:80])" <<< "$RESP" 2>/dev/null || echo "unparseable: ${RESP:0:80}")
  log "  offset=$OFFSET -> $STATUS"

  OFFSET=$((OFFSET + CHUNK))
  echo "$OFFSET" > "$CURSOR"
done

log "Run complete. Cursor at $OFFSET."
