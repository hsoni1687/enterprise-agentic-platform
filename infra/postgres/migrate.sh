#!/bin/bash
# =============================================================================
# Production-grade migration runner
#
# Behaviour:
#   1. Creates a _migration_history table (separate from schema_migrations) to
#      track exactly which files have been applied, their checksums, and when.
#   2. On each run it only executes migrations that have NOT been applied yet.
#   3. If an already-applied migration file has been modified (checksum changed)
#      the script FAILS loudly — editing applied migrations is forbidden in any
#      environment. Fix forward with a new migration file.
#   4. Each migration runs inside its own transaction so a failure is fully
#      rolled back and the history table is never updated for a failed file.
#   5. All output is timestamped for easy log parsing.
#
# Usage:
#   POSTGRES_URL=postgresql://... bash migrate.sh [migrations-dir]
# =============================================================================
set -euo pipefail

DB_URL="${POSTGRES_URL:-postgresql://postgres:postgres@localhost:5432/agentplatform}"
MIGRATIONS_DIR="${1:-$(cd "$(dirname "$0")/migrations" && pwd)}"
TIMESTAMP() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

log()  { echo "[$(TIMESTAMP)] $*"; }
ok()   { echo "[$(TIMESTAMP)] ✓ $*"; }
skip() { echo "[$(TIMESTAMP)] — $*"; }
fail() { echo "[$(TIMESTAMP)] ✗ $*" >&2; exit 1; }

log "Migration runner starting"
log "DB   : $DB_URL"
log "Dir  : $MIGRATIONS_DIR"

# ---------------------------------------------------------------------------
# 0. Wait for postgres to accept connections (up to 60 s)
# ---------------------------------------------------------------------------
log "Waiting for postgres..."
for i in $(seq 1 30); do
  if psql "$DB_URL" -c "SELECT 1" -q >/dev/null 2>&1; then
    log "Postgres ready after ${i}x2s"
    break
  fi
  if [ "$i" -eq 30 ]; then
    fail "Postgres not ready after 60 seconds — aborting"
  fi
  sleep 2
done

# ---------------------------------------------------------------------------
# 1. Bootstrap the history table (idempotent DDL — always safe to run)
# ---------------------------------------------------------------------------
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS _migration_history (
    filename    TEXT        PRIMARY KEY,
    checksum    TEXT        NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms INTEGER
);
SQL
log "History table ready"

# ---------------------------------------------------------------------------
# 2. Iterate files in deterministic alphabetical order
# ---------------------------------------------------------------------------
shopt -s nullglob
FILES=("$MIGRATIONS_DIR"/*.sql)

if [ ${#FILES[@]} -eq 0 ]; then
    log "No migration files found in $MIGRATIONS_DIR — nothing to do."
    exit 0
fi

APPLIED=0
SKIPPED=0
FAILED=0

for filepath in "${FILES[@]}"; do
    filename=$(basename "$filepath")

    # Compute SHA-256 of the file (portable: works on Linux + macOS)
    if command -v sha256sum &>/dev/null; then
        checksum=$(sha256sum "$filepath" | awk '{print $1}')
    else
        checksum=$(shasum -a 256 "$filepath" | awk '{print $1}')
    fi

    # Look up history
    row=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -tAq \
        -c "SELECT checksum FROM _migration_history WHERE filename = '$filename';" 2>/dev/null || true)

    if [ -n "$row" ]; then
        # Already applied — verify checksum integrity
        if [ "$row" != "$checksum" ]; then
            fail "CHECKSUM MISMATCH: '$filename' was already applied but the file has changed.
  Stored  : $row
  Current : $checksum
  Editing applied migrations is forbidden. Create a new migration file to fix forward."
        fi
        skip "$filename (already applied)"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    # New migration — apply inside a transaction
    log "Applying $filename ..."
    START_MS=$(date +%s%3N 2>/dev/null || echo 0)

    # Wrap in BEGIN/COMMIT so a SQL error rolls back the whole file atomically
    if psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<MIGRATION
BEGIN;
\i $filepath
COMMIT;
MIGRATION
    then
        END_MS=$(date +%s%3N 2>/dev/null || echo 0)
        DURATION=$(( END_MS - START_MS ))

        # Record success in history table
        psql "$DB_URL" -v ON_ERROR_STOP=1 -q \
            -c "INSERT INTO _migration_history (filename, checksum, applied_at, duration_ms)
                VALUES ('$filename', '$checksum', now(), $DURATION)
                ON CONFLICT (filename) DO NOTHING;"

        ok "$filename applied (${DURATION}ms)"
        APPLIED=$((APPLIED + 1))
    else
        FAILED=$((FAILED + 1))
        fail "Migration '$filename' FAILED — transaction rolled back. Fix the file and retry."
    fi
done

# ---------------------------------------------------------------------------
# 3. Summary
# ---------------------------------------------------------------------------
log "─────────────────────────────────────────"
log "Applied : $APPLIED"
log "Skipped : $SKIPPED (already up-to-date)"
if [ $FAILED -gt 0 ]; then
    log "Failed  : $FAILED"
    exit 1
fi
log "All migrations complete ✓"
