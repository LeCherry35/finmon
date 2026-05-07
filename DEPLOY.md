# AWS Deployment Guide

This project is deployed on AWS using **ECS Fargate** with a **PostgreSQL RDS** database. Docker images are stored in **ECR**.

## Infrastructure Overview

| Component | AWS Service | Name |
|---|---|---|
| Container registry | ECR | `finmon` |
| Database | RDS PostgreSQL | `finmon-db` |
| Container cluster | ECS Fargate | `finmon` |
| Running service | ECS Service | `finmon-service` |
| Task definition | ECS Task | `finmon-task` |
| Region | — | `us-east-1` |
| AWS Account ID | — | `536697268762` |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- [AWS CLI](https://aws.amazon.com/cli/) installed and configured (`aws configure`)
- Authenticated with ECR (see step 1 below)

---

## Redeploying After Changes

Run the following commands from the project root whenever you want to deploy a new version:

### Step 1 — Log in to ECR (once per terminal session)
```powershell
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 536697268762.dkr.ecr.us-east-1.amazonaws.com
```

### Step 2 — Build, tag, and push the Docker image
```powershell
docker build -t finmon .
docker tag finmon:latest 536697268762.dkr.ecr.us-east-1.amazonaws.com/finmon:latest
docker push 536697268762.dkr.ecr.us-east-1.amazonaws.com/finmon:latest
```

### Step 3 — Force ECS to redeploy
```powershell
aws ecs update-service --cluster finmon --service finmon-service --force-new-deployment --region us-east-1
```

ECS will pull the new image and restart the container automatically. The new version is usually live within 1-2 minutes.

> **Schema migrations** — any new `.sql` file in `src/db/migrations/` runs automatically on container start (via `src/instrumentation.ts`), each in its own transaction. If a migration fails the container won't serve traffic until you fix it. Take an RDS snapshot before deploys that include destructive migrations.

---

## One-Command Deploy Script

For convenience, use the included `deploy.ps1` script:

```powershell
.\deploy.ps1
```

Create `deploy.ps1` in the project root with:

```powershell
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 536697268762.dkr.ecr.us-east-1.amazonaws.com
docker build -t finmon .
docker tag finmon:latest 536697268762.dkr.ecr.us-east-1.amazonaws.com/finmon:latest
docker push 536697268762.dkr.ecr.us-east-1.amazonaws.com/finmon:latest
aws ecs update-service --cluster finmon --service finmon-service --force-new-deployment --region us-east-1
Write-Host "Deployment triggered successfully!" -ForegroundColor Green
```

---

## Environment Variables

The app requires the following environment variables, configured in the ECS Task Definition:

| Variable | Description |
|---|---|
| `SQL_DB_HOST` | RDS endpoint (e.g. `finmon-db.xxxxxx.us-east-1.rds.amazonaws.com`) |
| `SQL_DB_PORT` | `5432` |
| `SQL_DB_NAME` | postgres |
| `SQL_DB_USER` | postgres |
| `SQL_DB_PASSWORD` |  |
| `PGSSLMODE` | `require` — **legacy/redundant**; see SSL note below |

### About SSL

`src/db/index.ts` defaults to SSL with `rejectUnauthorized: false` — the connection is encrypted but the server cert is not verified. This is what RDS needs out of the box: RDS certs are signed by AWS RDS CAs, which are **not** in Node's default trust store, so any attempt at strict verification (`rejectUnauthorized: true`) will fail with `SELF_SIGNED_CERT_IN_CHAIN` and crash the container at startup.

`SQL_DB_SSL=false` is the only way to disable SSL — used for local dev against a plain Postgres. Don't set it in prod.

`PGSSLMODE=require` on the task definition is now redundant (the code passes an explicit `ssl` config, which `pg` uses in preference to libpq env vars). Harmless to leave in place; safe to remove in a follow-up.

If you ever want full cert verification, you'll need to bundle the RDS CA bundle into the image (download from `https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`) and load it via `ssl.ca`. That's a separate change.

### Updating env vars

To update environment variables: **ECS → Task definitions → finmon-task → Create new revision** → update vars → then update the service to use the new revision.

---

## Checking Logs

**Via AWS Console:**
CloudWatch → Log groups → `/ecs/finmon-task` → click latest log stream

**Via AWS CLI:**
```powershell
aws logs tail /ecs/finmon-task --follow --region us-east-1
```

---

## Accessing the App

The app runs on a public IP assigned to the ECS task on port `3000`.

To find the current IP:
**ECS → Clusters → finmon → Services → finmon-service → Tasks → click running task → Public IP**

Then open: `http://<public-ip>:3000`

> **Note:** The public IP changes every time the task is restarted. For a stable URL, set up an **Application Load Balancer (ALB)** in front of the service.