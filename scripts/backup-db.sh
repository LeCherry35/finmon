#!/usr/bin/env bash
# Nightly Postgres backup for the production droplet. Run by cron — see BACKUP.md
# for setup, restore, and retention details.
#
# Dumps the db container's database (custom format, pg_dump -Fc) into
# backups/auto/finmon-<timestamp>.dump and deletes dumps older than
# RETENTION_DAYS (default 14).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# .env holds SQL_DB_USER / SQL_DB_NAME; cron does not read it for us.
set -a
source .env
set +a

BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups/auto}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"

OUT="$BACKUP_DIR/finmon-$(date +%Y%m%d-%H%M%S).dump"
TMP="$OUT.part"
trap 'rm -f "$TMP"' EXIT

docker compose exec -T db pg_dump --no-owner --no-acl -Fc \
  -U "$SQL_DB_USER" "$SQL_DB_NAME" > "$TMP"

# A failed exec can still leave an empty file — never keep one as a "backup".
if [ ! -s "$TMP" ]; then
  echo "$(date -Is) backup FAILED: empty dump" >&2
  exit 1
fi

mv "$TMP" "$OUT"

find "$BACKUP_DIR" -name 'finmon-*.dump' -mtime +"$RETENTION_DAYS" -delete

echo "$(date -Is) backup OK: $OUT ($(du -h "$OUT" | cut -f1))"
