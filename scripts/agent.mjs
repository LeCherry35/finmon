// Starts the opencode sidecar for local dev, with the API keys from `.env` in
// its environment. Run via `npm run agent` (which adds `node --env-file=.env`).
//
// opencode does not read the project's `.env` — and the per-user configs finmon
// writes reference the keys as `{env:...}` placeholders (src/lib/opencode-config.ts),
// so they are resolved from *this* process's environment. In production the same
// keys are handed to the container in docker-compose.yml.
import { spawn } from "node:child_process";

const port = process.env.OPENCODE_URL ? new URL(process.env.OPENCODE_URL).port || "4096" : "4096";

const missing = ["OPENCODE_SERVER_PASSWORD"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`missing in .env: ${missing.join(", ")}`);
  process.exit(1);
}
if (process.env.LITELLM_BASE_URL && !process.env.LITELLM_API_KEY) {
  console.warn("warning: LITELLM_BASE_URL is set but LITELLM_API_KEY is not — litellm/* models will fail to authenticate.");
}

// `--pure` matches the pinned sidecar (opencode/Dockerfile): no local project or
// global config, so the lockdown check sees the same shape as in production.
const child = spawn("opencode", ["serve", "--port", port, "--pure"], {
  stdio: "inherit",
  shell: process.platform === "win32", // opencode is a .cmd shim on Windows
});

child.on("error", (err) => {
  console.error(`could not start opencode: ${err.message}`);
  console.error("install it with: npm i -g opencode-ai@1.18.28");
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
