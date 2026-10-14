// Runs the talk's assistant queries (mcp-pres-plan.md) against the LOCAL agent,
// once per model, and prints each reply with its tool calls and timing — the
// same prompts the chat UI sends, without clicking through it.
//
//   npm run agent:queries -- [options]
//
//   --models=openai/gpt-5,litellm/Qwen3.8-27B-NVFP4   default: every configured model
//   --queries=1,2,4                                   default: all
//   --email=demo@finmon.local                         whose data the agent sees
//   --out=report.md                                   also write a Markdown report
//   --keep                                            keep the sessions and pending proposals
//
// Needs `npm run dev` (the MCP endpoint) and `npm run agent` (opencode) running.
// Output goes query by query: each query on every model, then the next. Each
// model keeps one fresh session throughout, so follow-ups ("the transaction you
// just added") have their context. Writes only ever become proposals: this
// script can't Accept them, and unless --keep it rejects each turn's proposals
// right after it and deletes its sessions at the end (they aren't listed in the app).

import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { AGENT_NAME, MCP_KEY, buildOpencodeConfig } from "../src/lib/opencode-config.ts";

const QUERIES = [
  "What categories do I have?",
  "How much did I spend in August?",
  "Find my biggest Groceries purchase and list what was in it.",
  "Set September plans equal to my actual August spend.",
  "Run `ls` in a shell, read the file /etc/hosts and open https://example.com.",
  "Скільки я витратив на бензин в серпні",
  "На чому мені варто зекономити в цьому місяці?"
];

const TURN_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 1000;

// ---- args + env ------------------------------------------------------------

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);
if (!LOCAL_HOSTS.has(process.env.SQL_DB_HOST ?? "")) {
  console.error(`Refusing: SQL_DB_HOST "${process.env.SQL_DB_HOST}" is not local.`);
  process.exit(1);
}
const missing = ["OPENCODE_URL", "AGENT_MCP_URL", "AGENT_WORKSPACE_ROOT"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`missing in .env: ${missing.join(", ")}`);
  process.exit(1);
}

const list = (raw) => (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const withLitellm = (id) => (id.startsWith("litellm/") ? id : `litellm/${id}`);

// Same rules as src/lib/agent-models.ts (which can't be imported from plain Node).
const defaultModel = process.env.AGENT_MODEL || "openai/gpt-4.1-mini";
const litellmModels = process.env.LITELLM_BASE_URL ? list(process.env.AGENT_LITELLM_MODELS).map(withLitellm) : [];
const configured = [...new Set([defaultModel, ...list(process.env.AGENT_OPENCODE_MODELS), ...litellmModels])];
const models = args.models ? list(args.models) : configured;
const unknown = models.filter((m) => !configured.includes(m));
if (unknown.length) {
  console.error(`not configured in .env: ${unknown.join(", ")}\nconfigured: ${configured.join(", ")}`);
  process.exit(1);
}

const picked = args.queries ? list(args.queries).map(Number) : QUERIES.map((_, i) => i + 1);
if (picked.some((n) => !QUERIES[n - 1])) {
  console.error(`--queries takes numbers 1–${QUERIES.length}`);
  process.exit(1);
}

const email = typeof args.email === "string" ? args.email : "demo@finmon.local";
const opencodeUrl = process.env.OPENCODE_URL.replace(/\/$/, "");

// ---- the user's opencode instance (as src/lib/opencode.ts sets it up) ------

const pool = new pg.Pool({
  host: process.env.SQL_DB_HOST,
  port: Number(process.env.SQL_DB_PORT),
  database: process.env.SQL_DB_NAME,
  user: process.env.SQL_DB_USER,
  password: process.env.SQL_DB_PASSWORD,
  ssl: process.env.SQL_DB_SSL === "false" ? false : { rejectUnauthorized: false },
});

const { rows: users } = await pool.query(`SELECT id FROM "user" WHERE email = $1`, [email]);
if (users.length === 0) {
  console.error(`No user ${email}.`);
  process.exit(1);
}
const userId = users[0].id;

// Mirrors signAgentToken in src/lib/agent-token.ts (server-only there).
function signAgentToken(sub) {
  const secret = process.env.AGENT_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("AGENT_TOKEN_SECRET (or BETTER_AUTH_SECRET) must be set");
  const payload = Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60 })).toString("base64url");
  const mac = createHmac("sha256", secret).update(`finmon-agent:${payload}`).digest("base64url");
  return `${payload}.${mac}`;
}

const dirName = createHash("sha256").update(`finmon-agent-dir:${userId}`).digest("hex").slice(0, 32);
const localDir = path.join(process.env.AGENT_WORKSPACE_ROOT, dirName);
const directory = path.posix.join(
  (process.env.OPENCODE_WORKSPACE_ROOT || process.env.AGENT_WORKSPACE_ROOT).replace(/\\/g, "/"),
  dirName,
);

async function api(method, pathname, body) {
  const url = new URL(opencodeUrl + pathname);
  url.searchParams.set("directory", directory);
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (process.env.OPENCODE_SERVER_PASSWORD) {
    headers.Authorization = "Basic " + Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64");
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error(`opencode isn't reachable at ${opencodeUrl} — is \`npm run agent\` running?`);
  }
  if (!res.ok) throw new Error(`opencode ${method} ${pathname} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? undefined : res.json();
}

// A fresh token every run; the app keeps or rotates it on its next request.
const configPath = path.join(localDir, "opencode.json");
const previous = await readFile(configPath, "utf8").catch(() => null);
await mkdir(localDir, { recursive: true });
await writeFile(
  configPath,
  JSON.stringify(
    buildOpencodeConfig(signAgentToken(userId), {
      mcpUrl: process.env.AGENT_MCP_URL,
      model: defaultModel,
      litellmBaseUrl: process.env.LITELLM_BASE_URL || undefined,
      litellmModels: litellmModels.map((m) => m.slice("litellm/".length)),
    }),
    null,
    2,
  ),
  { mode: 0o600 },
);
if (previous !== null) await api("POST", "/instance/dispose").catch(() => {});

try {
  await fetch(new URL(process.env.AGENT_MCP_URL).origin, { method: "HEAD" });
} catch {
  console.error(`The app isn't reachable at ${new URL(process.env.AGENT_MCP_URL).origin} — is \`npm run dev\` running?`);
  process.exit(1);
}

const { providers = [] } = await api("GET", "/config/providers");
const unavailable = models.filter((m) => {
  const [p, ...rest] = m.split("/");
  return !providers.find((x) => x.id === p)?.models?.[rest.join("/")];
});
if (unavailable.length) {
  console.error(`opencode can't serve: ${unavailable.join(", ")} (its provider key is probably missing from opencode's env)`);
  process.exit(1);
}

const { rows: pendingRows } = await pool.query(
  `SELECT COUNT(*)::int AS n FROM agent_proposals WHERE user_id = $1 AND status = 'pending'`,
  [userId],
);
if (pendingRows[0].n > 0) {
  console.warn(`note: ${email} already has ${pendingRows[0].n} pending proposals (the agent stops proposing at 20).\n`);
}

// ---- running a turn --------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runTurn(sessionId, model, text) {
  const base = `/session/${encodeURIComponent(sessionId)}`;
  const before = (await api("GET", `${base}/message`)).length;
  const [providerID, ...rest] = model.split("/");
  const started = Date.now();
  await api("POST", `${base}/prompt_async`, {
    agent: AGENT_NAME,
    model: { providerID, modelID: rest.join("/") },
    tools: { "*": false, [`${MCP_KEY}_*`]: true },
    system: `Today is ${today}.`,
    parts: [{ type: "text", text }],
  });

  while (Date.now() - started < TURN_TIMEOUT_MS) {
    await sleep(POLL_MS);
    const status = await api("GET", "/session/status");
    const busy = ["busy", "retry"].includes(status?.[sessionId]?.type);
    const messages = (await api("GET", `${base}/message`)).slice(before);
    const last = messages.at(-1)?.info;
    const done = last?.role === "assistant" && (last.time?.completed || last.error);
    if (!busy && done) return summarize(messages, Date.now() - started);
  }
  await api("POST", `${base}/abort`).catch(() => {});
  return { seconds: TURN_TIMEOUT_MS / 1000, text: "", tools: [], error: "timed out", tokens: null };
}

function summarize(messages, ms) {
  const replies = messages.filter((m) => m.info.role === "assistant");
  const parts = replies.flatMap((m) => m.parts);
  const tools = parts
    .filter((p) => p.type === "tool")
    .map((p) => {
      let proposal = null;
      try {
        const out = JSON.parse(p.state?.output ?? "");
        if (out?.status === "pending_user_approval") proposal = (out.summary ?? `#${out.proposal_id}`).replace(/\n+/g, "; ");
      } catch {
        // plain-text output
      }
      return {
        name: p.tool?.startsWith(`${MCP_KEY}_`) ? p.tool.slice(MCP_KEY.length + 1) : p.tool,
        input: p.state?.input,
        status: p.state?.status,
        error: p.state?.error ?? null,
        proposal,
      };
    });
  const tokens = replies.reduce(
    (t, m) => ({ input: t.input + (m.info.tokens?.input ?? 0), output: t.output + (m.info.tokens?.output ?? 0) }),
    { input: 0, output: 0 },
  );
  const error = replies.map((m) => m.info.error?.data?.message ?? m.info.error?.name).find(Boolean) ?? null;
  return {
    seconds: Math.round(ms / 100) / 10,
    text: parts.filter((p) => p.type === "text" && !p.synthetic).map((p) => p.text).join("\n\n").trim(),
    tools,
    error,
    tokens,
  };
}

// ---- main ------------------------------------------------------------------

const results = []; // { model, n, query, ...turn }
const runStart = new Date();
const sessions = new Map(); // model → opencode session id
let rejected = 0;

/** Reject the proposals this run left pending, so the next turn isn't held up
 *  by the 20-pending cap (query 7 alone can make a dozen). */
async function rejectPending() {
  if (args.keep) return;
  const { rowCount } = await pool.query(
    `UPDATE agent_proposals SET status = 'rejected', decided_at = now()
     WHERE user_id = $1 AND status = 'pending' AND created_at >= $2`,
    [userId, runStart],
  );
  rejected += rowCount;
}

try {
  for (const model of models) {
    const session = await api("POST", "/session", {
      title: `agent-queries ${model}`,
      agent: AGENT_NAME,
      permission: [
        { permission: "*", pattern: "*", action: "deny" },
        { permission: `${MCP_KEY}_*`, pattern: "*", action: "allow" },
      ],
    });
    sessions.set(model, session.id);
  }

  // Query by query, every model in turn (each in its own session, so
  // follow-ups still have their context).
  for (const n of picked) {
    const query = QUERIES[n - 1];
    console.log(`\n${"=".repeat(70)}\n[${n}] ${query}`);
    for (const model of models) {
      console.log(`\n  --- ${model}`);
      const turn = await runTurn(sessions.get(model), model, query);
      await rejectPending();
      results.push({ model, n, query, ...turn });

      for (const t of turn.tools) {
        const mark = t.status === "error" ? "✗" : t.proposal ? "⏸" : "✓";
        console.log(`  ${mark} ${t.name} ${JSON.stringify(t.input ?? {})}${t.proposal ? `  → proposal: ${t.proposal}` : ""}${t.error ? `  → ${t.error}` : ""}`);
      }
      if (turn.error) console.log(`  ERROR: ${turn.error}`);
      console.log(turn.text.replace(/^/gm, "  │ "));
      // opencode's input count leaves out cached prompt tokens, so later turns look cheap.
      console.log(`  (${turn.seconds}s, ${turn.tools.length} tool calls, ${turn.tokens?.input ?? "?"} in / ${turn.tokens?.output ?? "?"} out tokens)`);
    }
  }
} finally {
  if (!args.keep) {
    await rejectPending();
    for (const id of sessions.values()) await api("DELETE", `/session/${encodeURIComponent(id)}`).catch(() => {});
    console.log(`\ncleanup: rejected ${rejected} proposals from this run, deleted ${sessions.size} sessions`);
  }
  await pool.end();
}

// ---- comparison ------------------------------------------------------------

console.log("\n=== summary (seconds / tool calls / proposals) ===");
const header = ["#", ...models];
const rows = picked.map((n) => [
  String(n),
  ...models.map((m) => {
    const r = results.find((x) => x.model === m && x.n === n);
    return r ? `${r.seconds}s / ${r.tools.length} / ${r.tools.filter((t) => t.proposal).length}${r.error ? " ERR" : ""}` : "-";
  }),
]);
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
for (const r of [header, ...rows]) console.log(r.map((c, i) => c.padEnd(widths[i])).join("  "));

if (typeof args.out === "string") {
  const cell = (s) => s.replace(/\|/g, "\\|").replace(/\n+/g, "<br>");
  let md = `# Agent queries — ${new Date().toISOString().slice(0, 16).replace("T", " ")}\n\nUser: ${email}\n`;
  for (const n of picked) {
    md += `\n## ${n}. ${QUERIES[n - 1]}\n\n| Model | Time | Tools | Reply |\n|---|---|---|---|\n`;
    for (const m of models) {
      const r = results.find((x) => x.model === m && x.n === n);
      if (!r) continue;
      const tools = r.tools.map((t) => `${t.name}${t.proposal ? " (proposal)" : ""}${t.status === "error" ? " (error)" : ""}`).join(", ");
      md += `| ${m} | ${r.seconds}s | ${cell(tools || "—")} | ${cell((r.error ? `ERROR: ${r.error}\n` : "") + r.text)} |\n`;
    }
  }
  await writeFile(args.out, md);
  console.log(`\nreport: ${args.out}`);
}
