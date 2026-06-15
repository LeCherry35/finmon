# Hetzner Deployment Guide

This project is deployed on a single **Hetzner Cloud VPS** running **Docker Compose**.
Two containers: the Next.js app and a **PostgreSQL** database on a private Docker
network. The app is built from this repo on the server and served over plain HTTP
on the server's public IP, port `3000`.

> Migrating from the old AWS/ECS deploy? See **[Restoring your existing data](#restoring-your-existing-data)**
> below to bring your existing rows across. The AWS guide is preserved in git history.

## Infrastructure Overview

| Component | What | Notes |
|---|---|---|
| Host | Hetzner Cloud VPS | Ubuntu 24.04, e.g. `CX22` (2 vCPU / 4 GB) |
| Orchestration | Docker Compose | `docker-compose.yml` in repo root |
| App container | `app` service | Built from `Dockerfile`, published on `:3000` |
| Database | `db` service | `postgres:18-alpine`, data on the `pgdata` volume |
| Source of truth | this git repo | Cloned onto the server; deploys are `git pull` + rebuild |

The DB is **not** published to the host — only the app reaches it, over the private
`finmon` network. Nothing listens on `5432` externally.

---

## Prerequisites

- A [Hetzner Cloud](https://www.hetzner.com/cloud) account and a project.
- An SSH key uploaded to Hetzner (or added during server creation).
- The repo accessible from the server (public clone URL, or a deploy key for a private repo).
- Values ready for: `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), a strong DB
  password, and `OPENAI_API_KEY` (optional, for receipt scanning).

---

## First-Time Setup

### Step 1 — Create the server

Hetzner Cloud Console → **Servers → Add Server**:

- **Location**: closest to you.
- **Image**: Ubuntu 24.04.
- **Type**: `CX22` (2 vCPU, 4 GB) is a comfortable starting point for app + Postgres.
- **SSH key**: select your uploaded key.
- **Firewall** (create/attach one): allow inbound **TCP 22** (SSH) and **TCP 3000**
  (the app). Leave everything else closed — Postgres stays internal.

Note the server's **public IPv4** once it boots.

> Prefer CLI? `hcloud server create --name finmon --type cx22 --image ubuntu-24.04 --ssh-key <key>`

### Step 2 — Install Docker

SSH in as root and install Docker (includes the Compose plugin):

```bash
ssh root@<server-ip>
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

### Step 3 — Clone the repo

```bash
git clone <your-repo-url> /root/opt/finmon
cd /root/opt/finmon
```

For a private repo, add a deploy key first or clone over HTTPS with a token.

### Step 4 — Create the `.env` file

Copy the template and fill in real values:

```bash
cp .env.production.example .env
nano .env
```

Set at minimum:

- `SQL_DB_NAME`, `SQL_DB_USER`, `SQL_DB_PASSWORD` — credentials for the Postgres
  container (any values you like; they're created on first boot).
- `BETTER_AUTH_SECRET` — `openssl rand -base64 32`. **Required.** Keep it stable.
- `BETTER_AUTH_URL` — `http://<server-ip>:3000`.
- `OPENAI_API_KEY` — optional, enables receipt scanning.

The compose file sets `SQL_DB_HOST=db`, `SQL_DB_PORT=5432`, and `SQL_DB_SSL=false`
for the app automatically — don't put those in `.env`.

### Step 5 — Build and start

```bash
docker compose up -d --build
```

Compose builds the app image, starts Postgres, waits until it's healthy, then starts
the app. On first request the app runs all pending migrations in `src/db/migrations/`
(via `src/instrumentation.ts`), each in its own transaction.

> **Fresh DB, no data import**: you'll register the first account through `/register`.
> The `OWNER_*` env vars (see `src/db/CLAUDE.md`) are **not** needed here — they only
> matter for a DB that has rows predating auth. If you're importing existing data,
> follow [Restoring your existing data](#restoring-your-existing-data) **before** the
> app's first run instead.

### Step 6 — Open the app

Browse to `http://<server-ip>:3000`. Register your account and you're live.

---

## Redeploying After Changes

From your machine, push changes to the repo. Then on the server:

```bash
cd /root/opt/finmon
git pull
docker compose up -d --build
```

Compose rebuilds the app image and recreates only the `app` container (Postgres and
its volume are untouched). New migrations run automatically on the next request.

### Optional convenience script

Create `/root/opt/finmon/deploy.sh` on the server:

```bash
#!/usr/bin/env bash
set -e
cd /root/opt/finmon
git pull
docker compose up -d --build
echo "Deployment complete."
```

`chmod +x deploy.sh`, then deploy with `./deploy.sh`. To trigger it from your
machine: `ssh root@<server-ip> '/root/opt/finmon/deploy.sh'`.

> **Schema migrations** — any new `.sql` file in `src/db/migrations/` runs
> automatically on container start, each in its own transaction. If a migration
> fails the app won't serve traffic until you fix it. Back up the DB before deploys
> with destructive migrations (see [Backups](#backups--restore)).

---

## Restoring your existing data

Your database dump is **`backups/finmon-db-20260609-205059.sql`** (plain-SQL `pg_dump`
from Postgres 18). The `backups/` folder is **gitignored**, so it is **not** on the
server after `git clone` — copy it up from your machine first (see step 1). Restore it
**once**, between Step 4 and Step 5, so the data lands before the app first runs.

That dump records migrations **001–006**. The repo also ships **007–010** (products,
price/amount/unit, status, store). So on the app's first boot the migration runner
automatically applies 007–010 on top of the restored data — creating the `products`
table, backfilling `status`/`store`, etc. Nothing extra to do, and the `OWNER_*` env
vars are **not** needed (migration 006 already ran in the dump and every row already
has a `user_id`).

1. **Copy the dump to the server** (run from your machine, where the file exists):

   ```bash
   scp backups/finmon-db-20260609-205059.sql root@<server-ip>:/root/opt/finmon/backups/
   ```

   (Create the folder first if needed: `ssh root@<server-ip> 'mkdir -p /root/opt/finmon/backups'`.)

2. **Start only Postgres** and wait for it to report healthy:

   ```bash
   cd /root/opt/finmon
   docker compose up -d db
   docker compose ps   # wait until db is "healthy"
   ```

3. **Restore the plain-SQL dump** into the container's database (use `psql`, not
   `pg_restore` — this is a `.sql` file). The DB must be empty, which it is on a
   first boot. Load `.env` into your shell first so `$SQL_DB_USER` / `$SQL_DB_NAME`
   are populated — the shell does **not** read `.env` automatically, and without this
   psql falls back to the OS user and fails with `role "root" does not exist`:

   ```bash
   set -a; source .env; set +a
   docker compose exec -T db psql -v ON_ERROR_STOP=1 \
     -U "$SQL_DB_USER" -d "$SQL_DB_NAME" \
     < backups/finmon-db-20260609-205059.sql
   ```

   (Or skip the `source` line and type your actual `.env` values into `-U` / `-d`.)
   A clean restore prints `CREATE TABLE` / `COPY N` / `ALTER TABLE` lines and no
   `ERROR:`.

4. **Start the app** — it connects, sees migrations 001–006 already recorded, and
   applies 007–010:

   ```bash
   docker compose up -d --build
   docker compose logs -f app   # watch the migrations run
   ```

> If you produce a **fresh** dump from RDS later, match its format: a plain `.sql`
> dump restores with `psql` (as above); a custom-format dump (`pg_dump -Fc`) restores
> with `docker compose exec -T db pg_restore --no-owner --no-acl -U "$SQL_DB_USER" -d "$SQL_DB_NAME"`.

Once you've confirmed the app and your data look right, decommission the AWS
resources (ECS service/task, RDS instance, ECR repo) to stop billing.

---

## Environment Variables

Set in `.env` on the server (template: `.env.production.example`).

| Variable | Required | Description |
|---|---|---|
| `SQL_DB_NAME` | yes | Postgres database name (created on first boot). |
| `SQL_DB_USER` | yes | Postgres user. |
| `SQL_DB_PASSWORD` | yes | Postgres password — use a long random value. |
| `BETTER_AUTH_SECRET` | yes | Session-signing key (`openssl rand -base64 32`). The app **throws at startup** if unset while `NODE_ENV=production`. Keep it stable — rotating it invalidates all sessions. (`next build` also imports the auth module, so the `Dockerfile` builder stage sets a throwaway placeholder to get past that guard — the real secret still comes from `.env` at runtime, and the placeholder never reaches the final image.) |
| `BETTER_AUTH_URL` | recommended | Full origin, `http://<server-ip>:3000`. The server IP is stable, so set it. Better Auth infers it from the request if left unset. |
| `OPENAI_API_KEY` | optional | Enables receipt scanning. Without it, scans return a friendly error and transactions work unchanged. |
| `OPENAI_MODEL` | optional | Vision model, default `gpt-4o-mini`. |

Set by `docker-compose.yml` (do **not** put these in `.env`): `NODE_ENV=production`,
`SQL_DB_HOST=db`, `SQL_DB_PORT=5432`, `SQL_DB_SSL=false`.

---

## Backups / Restore

Postgres data lives in the named Docker volume `pgdata`, which survives container
rebuilds and `docker compose down`. It does **not** survive `docker compose down -v`.

**Back up** (dump to a file on the host):

```bash
cd /root/opt/finmon
docker compose exec -T db pg_dump --no-owner --no-acl -Fc \
  -U "$SQL_DB_USER" "$SQL_DB_NAME" > "finmon-$(date +%F).dump"
```

Copy the dump off the server (e.g. `scp` to your machine, or a Hetzner Storage Box).
Take one before any destructive migration.

**Restore** a dump into a running DB: same `pg_restore` command as in the migration
section above.

---

## Checking Logs & Status

```bash
cd /root/opt/finmon
docker compose ps                 # container status / health
docker compose logs -f app        # app logs (follow)
docker compose logs -f db         # Postgres logs
docker compose logs --tail=200 app
```

---

## Accessing the App

`http://<server-ip>:3000` — the Hetzner VPS keeps a **stable public IP** (unlike the
old ECS task), so the URL no longer changes between deploys.

---

## Known Limitations & Deferred Work

No load balancer or HTTPS yet — the app is served over plain HTTP on the raw IP, so
sessions still rely on the non-secure-cookie workaround. The Hetzner move already
resolved the unstable-IP issues from the AWS era.

| Limitation | Where | Why / current state | Resolved by |
|---|---|---|---|
| **No TLS / plain HTTP** | — | Browser ↔ server traffic is unencrypted on `:3000`. | Add a domain + a reverse proxy (**Caddy** gives automatic Let's Encrypt HTTPS), then point it at the app. |
| **Insecure session cookies** | `src/lib/auth.ts` (`advanced.useSecureCookies: false`) | Over HTTP, a `Secure` cookie is dropped by the browser and login bounces back to `/login`. Forcing non-secure cookies keeps sessions working. | Front the app with HTTPS, then set `useSecureCookies: true` (or remove the override). |
| **Email auth flows disabled** | `src/lib/auth.ts` (commented hooks), `src/lib/email.ts` | Email verification, password reset, and verification emails are commented out — sign-up has no verification gate and auto signs in. | Re-enable the commented Better Auth hooks once `RESEND_API_KEY` / `RESEND_FROM_EMAIL` are set. |

### Optional next step — HTTPS with a domain

Point a domain's `A` record at the server IP, open port `443` on the firewall, and add
a Caddy container as a reverse proxy in front of the app — Caddy obtains and renews a
Let's Encrypt cert automatically. Then set `BETTER_AUTH_URL=https://<domain>` and flip
`useSecureCookies` to `true`. That's the single change that clears the remaining
limitations above.
