import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentModels } from "@/lib/agent-models";
import { signAgentToken, verifyAgentToken } from "@/lib/agent-token";
import { AGENT_NAME, MCP_KEY, RECEIPT_SYSTEM_PROMPT, buildOpencodeConfig } from "@/lib/opencode-config";

// Talks to the opencode sidecar (`opencode serve`) over its HTTP API.
//
// Multi-tenancy: opencode's MCP headers are static per config, so every user
// gets their own opencode *instance directory* — `<workspace>/<hash(userId)>/`
// holding an opencode.json whose finmon MCP entry carries that user's bearer
// token. Every API call passes `?directory=` so opencode loads that user's
// config (and so only their token reaches /api/agent/mcp).
//
// Lockdown: the generated config denies every permission and every tool except
// the finmon MCP tools, disables the stock agents, and each session is created
// with the same deny-all ruleset. assertToolLockdown() checks opencode's
// resolved agent permissions before prompts are sent, and fails closed.

/** Rotate a user's token when less than this remains. */
const TOKEN_REFRESH_MARGIN_SECONDS = 2 * 60 * 60;

type Env = {
  url: string;
  password: string | undefined;
  mcpUrl: string;
  /** Where finmon writes the per-user dirs (its own filesystem view). */
  workspaceRoot: string;
  /** The same dirs as the opencode process sees them (differs across containers only if mounted elsewhere). */
  opencodeWorkspaceRoot: string;
  /** The default model (AGENT_MODEL). */
  model: string;
  /** Base URL (usually ending in /v1) for `litellm/<model>` models. */
  litellmBaseUrl: string | undefined;
  /** Selectable LiteLLM model ids, registered in every user's config. */
  litellmModels: string[];
};

export class AgentUnavailableError extends Error {}

function env(): Env {
  const url = process.env.OPENCODE_URL;
  const mcpUrl = process.env.AGENT_MCP_URL;
  const workspaceRoot = process.env.AGENT_WORKSPACE_ROOT;
  if (!url || !mcpUrl || !workspaceRoot) {
    throw new AgentUnavailableError("The assistant isn't configured on this server.");
  }
  const models = agentModels();
  return {
    url: url.replace(/\/$/, ""),
    password: process.env.OPENCODE_SERVER_PASSWORD,
    mcpUrl,
    workspaceRoot,
    opencodeWorkspaceRoot: process.env.OPENCODE_WORKSPACE_ROOT || workspaceRoot,
    model: models.default,
    litellmBaseUrl: process.env.LITELLM_BASE_URL || undefined,
    litellmModels: models.litellmIds,
  };
}

export function isAgentConfigured(): boolean {
  return !!(process.env.OPENCODE_URL && process.env.AGENT_MCP_URL && process.env.AGENT_WORKSPACE_ROOT);
}

/** Directory name for a user: a hash, so user ids never shape filesystem paths. */
const userDirName = (userId: string) =>
  createHash("sha256").update(`finmon-agent-dir:${userId}`).digest("hex").slice(0, 32);

async function api<T>(
  e: Env,
  method: "GET" | "POST" | "DELETE",
  pathname: string,
  directory: string,
  body?: unknown,
): Promise<T> {
  const url = new URL(e.url + pathname);
  url.searchParams.set("directory", directory);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (e.password) {
    headers.Authorization = "Basic " + Buffer.from(`opencode:${e.password}`).toString("base64");
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      // Turns run in the background (prompt_async), so every call is short.
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.error(`opencode ${method} ${pathname} failed:`, err);
    throw new AgentUnavailableError("The assistant is not reachable right now.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`opencode ${method} ${pathname} → ${res.status}: ${text.slice(0, 500)}`);
    throw new AgentUnavailableError("The assistant returned an error.");
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Make sure the user's instance directory exists with a config holding a
 * token that won't expire soon. Returns the directory as opencode sees it.
 */
async function ensureUserInstance(userId: string, e: Env): Promise<string> {
  const name = userDirName(userId);
  const localDir = path.join(e.workspaceRoot, name);
  const opencodeDir = path.posix.join(e.opencodeWorkspaceRoot.replace(/\\/g, "/"), name);
  const configPath = path.join(localDir, "opencode.json");

  let raw: string | null = null;
  let current: string | null = null;
  try {
    raw = await readFile(configPath, "utf8");
    const header: string | undefined = JSON.parse(raw)?.mcp?.[MCP_KEY]?.headers?.Authorization;
    current = header?.startsWith("Bearer ") ? header.slice(7) : null;
  } catch {
    // missing or unreadable → (re)write below
  }

  const now = Math.floor(Date.now() / 1000);
  const stillValid =
    current && verifyAgentToken(current, now + TOKEN_REFRESH_MARGIN_SECONDS) === userId;
  // Keep a valid token, but still rewrite if anything else changed (e.g.
  // AGENT_MODEL switched provider) so env changes reach existing users.
  const token = stillValid ? current! : signAgentToken(userId, now).token;
  const next = JSON.stringify(buildOpencodeConfig(token, e), null, 2);
  if (next === raw) return opencodeDir;

  await mkdir(localDir, { recursive: true });
  await writeFile(configPath, next, { mode: 0o600 });
  if (raw !== null) {
    // A running instance cached the old config — drop it so the new one loads.
    await api(e, "POST", "/instance/dispose", opencodeDir).catch(() => {});
    lockdownVerified.delete(opencodeDir);
    for (const key of modelVerified.keys()) {
      if (key.startsWith(`${opencodeDir}|`)) modelVerified.delete(key);
    }
  }
  return opencodeDir;
}

/** Directories whose lockdown was verified recently (directory → checked-at ms). */
const lockdownVerified = new Map<string, number>();
const LOCKDOWN_RECHECK_MS = 10 * 60_000;

/**
 * Fail closed unless opencode's *resolved* view of this user's instance matches
 * the lockdown: the finmon agent's permission ruleset ends in "deny everything,
 * allow finmon_*" (opencode applies the last matching rule), the stock
 * build/plan/general/explore agents are gone, and finmon is the only MCP
 * server. (opencode's /experimental/tool lists built-ins regardless of
 * permissions, so it can't be used for this.)
 */
export async function assertToolLockdown(e: Env, directory: string) {
  const checkedAt = lockdownVerified.get(directory);
  if (checkedAt && Date.now() - checkedAt < LOCKDOWN_RECHECK_MS) return;

  const [agents, mcp] = await Promise.all([
    api<{ name: string; permission?: { permission: string; pattern: string; action: string }[] }[]>(
      e, "GET", "/agent", directory,
    ),
    api<Record<string, unknown>>(e, "GET", "/mcp", directory),
  ]);
  const problems = lockdownProblems(agents, mcp);
  if (problems.length > 0) {
    lockdownVerified.delete(directory);
    console.error(`Agent lockdown check failed: ${problems.join("; ")}`);
    throw new AgentUnavailableError("The assistant is misconfigured and has been disabled.");
  }
  lockdownVerified.set(directory, Date.now());
}

/** Pure part of assertToolLockdown — every way the instance violates the lockdown. */
export function lockdownProblems(
  agents: { name: string; permission?: { permission: string; pattern: string; action: string }[] }[],
  mcp: Record<string, unknown>,
): string[] {
  const problems: string[] = [];
  const agent = agents.find((a) => a.name === AGENT_NAME);
  if (!agent) problems.push("finmon agent missing");
  const rules = agent?.permission ?? [];
  const lastDeny = rules.findLastIndex(
    (r) => r.permission === "*" && r.pattern === "*" && r.action === "deny",
  );
  if (lastDeny === -1) problems.push("no deny-all rule");
  // opencode appends an external_directory allow for its own tool-output dir
  // (where it spills long tool results). That permission only gates file tools
  // (read/bash/…), which the deny-all already blocks, so it grants nothing.
  const after = rules
    .slice(lastDeny + 1)
    .filter((r) => !(r.permission === "external_directory" && /[\\/]opencode[\\/]tool-output[\\/]\*$/.test(r.pattern)));
  if (lastDeny !== -1 && after.some((r) => !(r.permission === `${MCP_KEY}_*` && r.action === "allow"))) {
    problems.push(`rules after deny-all: ${after.map((r) => `${r.permission}=${r.action}`).join(", ")}`);
  }
  const stock = agents.filter((a) => ["build", "plan", "general", "explore"].includes(a.name));
  if (stock.length > 0) problems.push(`stock agents enabled: ${stock.map((a) => a.name).join(", ")}`);
  const servers = Object.keys(mcp);
  if (servers.some((k) => k !== MCP_KEY)) problems.push(`extra MCP servers: ${servers.join(", ")}`);
  return problems;
}

type ModelRef = { providerID: string; modelID: string };
const modelRef = (model: string): ModelRef => {
  const [providerID, ...rest] = model.split("/");
  return { providerID, modelID: rest.join("/") };
};

/** `directory|model` pairs opencode confirmed it can serve (→ checked-at ms). */
const modelVerified = new Map<string, number>();
const MODEL_RECHECK_MS = 10 * 60_000;

/**
 * Fail fast when opencode can't serve the chosen model. A provider whose API
 * key is missing from the opencode *process's* environment is never registered
 * (the per-user config references keys as `{env:…}` placeholders), yet
 * prompt_async still accepts the turn — which then dies before writing any
 * assistant message, leaving the chat with no reply and no error. Only
 * successes are cached, so a fixed environment is picked up on the next send.
 */
async function assertModelAvailable(e: Env, directory: string, model: string) {
  const key = `${directory}|${model}`;
  const checkedAt = modelVerified.get(key);
  if (checkedAt && Date.now() - checkedAt < MODEL_RECHECK_MS) return;

  const { providerID, modelID } = modelRef(model);
  const { providers } = await api<{ providers?: { id: string; models?: Record<string, unknown> }[] }>(
    e,
    "GET",
    "/config/providers",
    directory,
  );
  if (!providers?.find((p) => p.id === providerID)?.models?.[modelID]) {
    const known = (providers ?? []).map((p) => p.id).join(", ") || "none";
    console.error(
      `Model ${model} is not available in opencode (registered providers: ${known}). ` +
        `Its provider key is probably missing from the opencode process's environment.`,
    );
    throw new AgentUnavailableError(`The model "${model}" isn't available right now.`);
  }
  modelVerified.set(key, Date.now());
}

const SESSION_PERMISSIONS = [
  { permission: "*", pattern: "*", action: "deny" },
  { permission: `${MCP_KEY}_*`, pattern: "*", action: "allow" },
];

/** Tool switches sent with every prompt: nothing but finmon tools. */
const PROMPT_TOOLS = { "*": false, [`${MCP_KEY}_*`]: true };

/** A turn with an attached receipt photo: only scanning and proposing the
 *  transaction. Narrows PROMPT_TOOLS — the session/config lockdown is unchanged. */
const RECEIPT_PROMPT_TOOLS = {
  "*": false,
  [`${MCP_KEY}_scan_receipt`]: true,
  [`${MCP_KEY}_create_transaction`]: true,
};

export type PromptMode = "chat" | "receipt";

export async function createAgentSession(userId: string, title: string): Promise<string> {
  const e = env();
  const directory = await ensureUserInstance(userId, e);
  const session = await api<{ id: string }>(e, "POST", "/session", directory, {
    title,
    agent: AGENT_NAME,
    permission: SESSION_PERMISSIONS,
  });
  return session.id;
}

// ---- messages ------------------------------------------------------------

type RawPart = {
  id: string;
  type: string;
  text?: string;
  synthetic?: boolean;
  tool?: string;
  state?: { status: string; input?: unknown; output?: string; error?: string };
};
export type RawMessage = {
  info: { id: string; role: "user" | "assistant"; time: { created: number }; error?: { name?: string; data?: { message?: string } } };
  parts: RawPart[];
};

/** A chat message reduced to what the UI renders. */
export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  createdAt: number;
  text: string;
  /** finmon tool calls, in order. */
  tools: { name: string; status: "running" | "completed" | "error"; proposalId: number | null; error: string | null }[];
  error: string | null;
  /** The receipt photo attached to a user message (agent_attachments.id). */
  attachmentId: number | null;
};

/** How an attached photo is referenced in the user's message — the agent only
 *  ever sees this marker, and passes the id to scan_receipt. */
export const attachmentMarker = (id: number) => `[Image attached: receipt #${id}]`;
const ATTACHMENT_MARKER_RE = /\s*\[Image attached: receipt #(\d+)\]\s*$/;

/** Marks messages finmon posts on the user's behalf (proposal decisions). */
const NOTE_PREFIX = "[finmon] ";

/** Exported for tests. */
export function toAgentMessage(m: RawMessage): AgentMessage | null {
  const texts = m.parts.filter((p) => p.type === "text" && p.text && !p.synthetic).map((p) => p.text!);
  let text = texts.join("\n\n").trim();
  if (m.info.role === "user" && text.startsWith(NOTE_PREFIX)) return null;
  let attachmentId: number | null = null;
  const marker = m.info.role === "user" ? ATTACHMENT_MARKER_RE.exec(text) : null;
  if (marker) {
    attachmentId = Number(marker[1]);
    text = text.slice(0, marker.index).trim();
  }

  const tools = m.parts
    .filter((p) => p.type === "tool" && p.tool?.startsWith(`${MCP_KEY}_`))
    .map((p) => {
      let proposalId: number | null = null;
      if (p.state?.status === "completed" && p.state.output) {
        try {
          const out = JSON.parse(p.state.output);
          if (out?.status === "pending_user_approval" && Number.isInteger(out.proposal_id)) {
            proposalId = out.proposal_id;
          }
        } catch {
          // non-JSON output (e.g. a tool error message)
        }
      }
      const status: AgentMessage["tools"][number]["status"] =
        p.state?.status === "completed" ? "completed" : p.state?.status === "error" ? "error" : "running";
      return {
        name: p.tool!.slice(MCP_KEY.length + 1),
        status,
        proposalId,
        error: p.state?.status === "error" ? p.state.error ?? "Tool failed" : null,
      };
    });

  const err = m.info.error ? m.info.error.data?.message ?? m.info.error.name ?? "Error" : null;
  if (!text && tools.length === 0 && !err && attachmentId === null) return null;
  return { id: m.info.id, role: m.info.role, createdAt: m.info.time.created, text, tools, error: err, attachmentId };
}

export async function getAgentMessages(userId: string, sessionId: string): Promise<AgentMessage[]> {
  const e = env();
  const directory = await ensureUserInstance(userId, e);
  const raw = await api<RawMessage[]>(
    e,
    "GET",
    `/session/${encodeURIComponent(sessionId)}/message`,
    directory,
  );
  return raw.map(toAgentMessage).filter((m): m is AgentMessage => m !== null);
}

/** Start the agent's turn on the user's message and return at once; the turn
 *  runs on in opencode (see isSessionBusy).
 *  `receipt` mode (a photo is attached) adds the receipt instructions and
 *  limits the turn to scan_receipt + create_transaction, and always runs on the
 *  default model. `model` (already validated) picks the model for a chat turn. */
export async function sendAgentPrompt(
  userId: string,
  sessionId: string,
  text: string,
  mode: PromptMode = "chat",
  model?: string,
): Promise<void> {
  const e = env();
  const directory = await ensureUserInstance(userId, e);
  await assertToolLockdown(e, directory);
  const chosen = mode === "receipt" || !model ? e.model : model;
  await assertModelAvailable(e, directory, chosen);
  const today = new Date().toISOString().slice(0, 10);
  // prompt_async stores the user message and returns (204) while the turn
  // runs on in opencode — so it doesn't depend on the browser staying around.
  await api(e, "POST", `/session/${encodeURIComponent(sessionId)}/prompt_async`, directory, {
    agent: AGENT_NAME,
    model: modelRef(chosen),
    tools: mode === "receipt" ? RECEIPT_PROMPT_TOOLS : PROMPT_TOOLS,
    system: mode === "receipt" ? `Today is ${today}.\n\n${RECEIPT_SYSTEM_PROMPT}` : `Today is ${today}.`,
    parts: [{ type: "text", text }],
  });
}

/** The user's sessions that have a turn running (opencode's own status, so
 *  it's right across page changes and app restarts). Idle sessions aren't listed. */
export async function busySessionIds(userId: string): Promise<Set<string>> {
  const e = env();
  const directory = await ensureUserInstance(userId, e);
  const status = await api<Record<string, { type: string } | undefined>>(e, "GET", "/session/status", directory);
  return new Set(
    Object.entries(status ?? {})
      .filter(([, s]) => s?.type === "busy" || s?.type === "retry")
      .map(([id]) => id),
  );
}

/** Whether the session has a turn running. */
export async function isSessionBusy(userId: string, sessionId: string): Promise<boolean> {
  return (await busySessionIds(userId)).has(sessionId);
}

const IDLE_POLL_MS = 500;
const IDLE_MAX_WAIT_MS = 15_000;

/** Wait (bounded) for the session's running turn to end. */
export async function waitUntilIdle(userId: string, sessionId: string): Promise<void> {
  const deadline = Date.now() + IDLE_MAX_WAIT_MS;
  while (Date.now() < deadline && (await isSessionBusy(userId, sessionId))) {
    await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
  }
}

/** Stop the session's running turn; its assistant message ends as MessageAbortedError. */
export async function abortAgentSession(userId: string, sessionId: string): Promise<void> {
  const e = env();
  const directory = await ensureUserInstance(userId, e);
  await api(e, "POST", `/session/${encodeURIComponent(sessionId)}/abort`, directory);
}

/**
 * Permanently delete the last turn: the last message the user wrote (finmon's
 * own notes don't count) and everything after it, so the conversation is back
 * where it was before that send. Returns what the caller needs to finish the
 * undo: the proposals those messages created (to reject), the user's text and
 * attachment (to put back in the composer), and how many messages remain.
 */
export async function deleteLastTurn(
  userId: string,
  sessionId: string,
): Promise<{ proposalIds: number[]; text: string; attachmentId: number | null; remaining: number }> {
  const e = env();
  const directory = await ensureUserInstance(userId, e);
  const base = `/session/${encodeURIComponent(sessionId)}/message`;
  const raw = await api<RawMessage[]>(e, "GET", base, directory);
  const parsed = raw.map(toAgentMessage);
  // A user message toAgentMessage keeps is one the user wrote (notes → null).
  const start = parsed.findLastIndex((m) => m?.role === "user");
  if (start === -1) return { proposalIds: [], text: "", attachmentId: null, remaining: raw.length };

  const doomed = parsed.slice(start);
  for (const m of raw.slice(start)) {
    await api(e, "DELETE", `${base}/${encodeURIComponent(m.info.id)}`, directory);
  }
  return {
    proposalIds: doomed
      .flatMap((m) => m?.tools.map((t) => t.proposalId) ?? [])
      .filter((id): id is number => id !== null),
    text: parsed[start]!.text,
    attachmentId: parsed[start]!.attachmentId,
    remaining: start,
  };
}

/** Tell the agent (without triggering a reply) what the user decided on a proposal. */
export async function noteProposalDecision(
  userId: string,
  sessionId: string,
  note: string,
): Promise<void> {
  const e = env();
  const directory = await ensureUserInstance(userId, e);
  await api(e, "POST", `/session/${encodeURIComponent(sessionId)}/message`, directory, {
    agent: AGENT_NAME,
    model: modelRef(e.model),
    tools: PROMPT_TOOLS,
    noReply: true,
    parts: [{ type: "text", text: NOTE_PREFIX + note }],
  });
}
