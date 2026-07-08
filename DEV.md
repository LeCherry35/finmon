# Local development

How to run finmon locally. (Production deployment lives in `DEPLOY.md`.)

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

Requires a local PostgreSQL (`createdb finmon`) and env vars in `.env` — see
`.env example` and the env-var list in `src/db/CLAUDE.md`. Migrations apply
automatically on the first request; there is no separate init step.

## Test account

Local dev login (email/password at `/login`):

- **Email:** `test@email.com`
- **Password:** `password`

Dev-only credentials for the local database — not used anywhere else. To get
realistic data for it, set `OWNER_USER_ID` to the account's user id in `.env`
and run `npm run db:seed:init`.

## Useful commands

```bash
npm test                 # unit tests (Vitest)
npm run lint             # ESLint
npm run build            # production build
npm run db:seed:init     # deterministic 3-month seed dataset (see src/db/CLAUDE.md)
```
