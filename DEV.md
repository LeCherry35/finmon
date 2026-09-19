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

## AI assistant (optional)

The assistant (`/assistant`, header link, mobile button) appears only when the assistant env vars are set (see `src/db/CLAUDE.md`). Locally, run opencode yourself:

```bash
npm i -g opencode-ai@1.18.28
opencode serve --port 4096 --pure   # with OPENCODE_SERVER_PASSWORD in its env
```

and add to `.env`:

```
OPENCODE_URL=http://127.0.0.1:4096
OPENCODE_SERVER_PASSWORD=<same as opencode's>
AGENT_MCP_URL=http://127.0.0.1:3000/api/agent/mcp
AGENT_WORKSPACE_ROOT=<any writable dir>
AGENT_MODEL=opencode/big-pickle
```

To use a model behind a LiteLLM server instead, set `AGENT_MODEL=litellm/<model>` and `LITELLM_BASE_URL=https://<host>/v1` in `.env`, and put `LITELLM_API_KEY` in the **opencode** process's env (not the app's).

To try the per-chat model picker, list extra models: `AGENT_OPENCODE_MODELS=provider/model,…` (built-in opencode providers) and/or `AGENT_LITELLM_MODELS=<name>,…` (LiteLLM names, `litellm/` prefix optional, needs `LITELLM_BASE_URL`). The picker shows only when more than one model is configured.

"The assistant returned an error" with a 401 in the dev log means the two passwords differ.

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
