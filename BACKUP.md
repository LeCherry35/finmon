# Database Backups

Everything about backing up and restoring the production Postgres database lives
here. Deployment itself is covered in [DEPLOY.md](DEPLOY.md).

## What gets backed up

All application data lives in the `db` container (`postgres:18-alpine`) on the
droplet, on the `pgdata` Docker volume. The volume survives container rebuilds
and `docker compose down`, but **not** `docker compose down -v`, a broken volume,
or the droplet itself dying — which is what dumps are for.

Backups are custom-format `pg_dump` dumps (`-Fc`), restored with `pg_restore`.
They contain every table — users, sessions, transactions, products, receipts
(including scanned receipt photos, stored as `BYTEA`), plans, bug reports — so a
dump is a complete snapshot of the app's state.

## Automatic nightly backups

`scripts/backup-db.sh` does one backup run: it loads `.env`, runs `pg_dump`
inside the running `db` container, writes the dump to
`backups/auto/finmon-<YYYYMMDD-HHMMSS>.dump`, and deletes dumps older than
**14 days** (override with the `RETENTION_DAYS` env var; `BACKUP_DIR` overrides
the target folder). A failed or empty dump is discarded — it never leaves a
truncated `.dump` file behind (`.part` files are the in-progress marker).

`backups/` is gitignored, so dumps never end up in the repo.

### One-time setup on the droplet

After a `git pull` brings the script to the server:

```bash
chmod +x /root/opt/finmon/scripts/backup-db.sh

# Try one run manually — it should print "backup OK: ..." and create the file:
/root/opt/finmon/scripts/backup-db.sh

# Schedule it nightly at 03:00 server time:
(crontab -l 2>/dev/null; echo '0 3 * * * /root/opt/finmon/scripts/backup-db.sh >> /var/log/finmon-backup.log 2>&1') | crontab -
```

That's it — cron runs the script every night from then on, no further action
needed.

### Checking on it

```bash
crontab -l                                # confirm the schedule is registered
tail /var/log/finmon-backup.log           # one "backup OK" line per night
ls -lh /root/opt/finmon/backups/auto/     # the dumps themselves (~14 files)
```

If a run fails, the log line says `backup FAILED` (or shows the pg_dump error)
instead of `backup OK`.

## Manual backup

For an on-demand snapshot — **always take one before a deploy with a destructive
migration**:

```bash
cd /root/opt/finmon
./scripts/backup-db.sh
```

Or by hand, to a location of your choosing:

```bash
set -a; source .env; set +a
docker compose exec -T db pg_dump --no-owner --no-acl -Fc \
  -U "$SQL_DB_USER" "$SQL_DB_NAME" > "finmon-$(date +%F).dump"
```

## Restore

Restore a custom-format dump into the running `db` container:

```bash
cd /root/opt/finmon
set -a; source .env; set +a
docker compose exec -T db pg_restore --no-owner --no-acl --clean --if-exists \
  -U "$SQL_DB_USER" -d "$SQL_DB_NAME" < backups/auto/finmon-<timestamp>.dump
```

`--clean --if-exists` drops and recreates objects so the restore lands on a
non-empty database. Restart the app afterwards (`docker compose restart app`) so
it re-checks migrations — restoring a dump made before newer migrations shipped
is fine; the runner applies the missing ones on the next start.

For restoring a **plain-SQL** dump (`.sql`, from `pg_dump` without `-Fc`) into an
**empty** database — e.g. rebuilding a droplet from scratch — use `psql` instead;
that flow is documented step-by-step in
[DEPLOY.md → Restoring your existing data](DEPLOY.md#restoring-your-existing-data).

## Off-site copies

The nightly dumps live **on the same droplet** as the database — they protect
against bad migrations and fat-fingered deletes, not against losing the droplet.
Periodically copy a recent dump off the server:

```bash
scp root@<server-ip>:/root/opt/finmon/backups/auto/finmon-<timestamp>.dump backups/
```

Automating off-site upload (e.g. rclone to DigitalOcean Spaces on the same cron)
is deferred work — the script's output directory is the natural hook point.

## Snapshot inventory

Known historical backups, for reference (all gitignored / off-repo):

| Snapshot | Where | Notes |
|---|---|---|
| `backups/finmon-2026-06-29.dump` | local machine | Custom-format dump from prod, schema at migrations 001–006. |
| `backups/finmon-db-20260609-205059.sql` | local machine | Plain-SQL dump from the old AWS/RDS deploy (pg 18); used for the droplet migration. |
| 2 RDS snapshots | AWS account | Final snapshots kept from the decommissioned RDS instance (June 2026). |
