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

The assistant (`/assistant`, header link, mobile button) appears only when the assistant env vars are set (see `src/db/CLAUDE.md`). It talks to a **separate opencode process** — in production a Docker sidecar (`opencode/Dockerfile`), locally a second terminal alongside `npm run dev`:

```bash
npm i -g opencode-ai@1.18.28   # once; pinned to the version the lockdown was verified against
npm run agent                  # `opencode serve --pure`, with .env loaded into its environment
```

Start it with `npm run agent`, not `opencode serve` by hand: opencode doesn't read `.env`, and the per-user configs reference provider keys as `{env:…}` placeholders (`src/lib/opencode-config.ts`), so it resolves them from its own environment. From a bare shell the provider replies "Authentication Error, No api key passed in."

Add to `.env`:

```
OPENCODE_URL=http://127.0.0.1:4096
OPENCODE_SERVER_PASSWORD=<any secret; npm run agent passes it to opencode>
AGENT_MCP_URL=http://127.0.0.1:3000/api/agent/mcp
AGENT_WORKSPACE_ROOT=<any writable dir>
AGENT_MODEL=opencode/big-pickle
```

To use a model behind a LiteLLM server instead, set `AGENT_MODEL=litellm/<model>`, `LITELLM_BASE_URL=https://<host>/v1` and `LITELLM_API_KEY`. (In production the key goes in the **opencode** container's env, not the app's — `docker-compose.yml`.)

To try the per-chat model picker, list extra models: `AGENT_OPENCODE_MODELS=provider/model,…` (built-in opencode providers) and/or `AGENT_LITELLM_MODELS=<name>,…` (LiteLLM names, `litellm/` prefix optional, needs `LITELLM_BASE_URL`). The picker shows only when more than one model is configured.

Troubleshooting: "The assistant returned an error" with a 401 in the dev log means the two passwords differ. `The model "…" isn't available right now` means opencode has no provider for it — check the key is in the env you started it with (`curl -u opencode:$OPENCODE_SERVER_PASSWORD http://127.0.0.1:4096/config/providers` lists what it has).

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
