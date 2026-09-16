import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { signAgentToken, verifyAgentToken } from "@/lib/agent-token";
import { AGENT_NAME, MCP_KEY, buildOpencodeConfig } from "@/lib/opencode-config";

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
  model: string;
};

export class AgentUnavailableError extends Error {}

function env(): Env {
  const url = process.env.OPENCODE_URL;
  const mcpUrl = process.env.AGENT_MCP_URL;
  const workspaceRoot = process.env.AGENT_WORKSPACE_ROOT;
  if (!url || !mcpUrl || !workspaceRoot) {
    throw new AgentUnavailableError("The assistant isn't configured on this server.");
  }
  return {
    url: url.replace(/\/$/, ""),
    password: process.env.OPENCODE_SERVER_PASSWORD,
    mcpUrl,
    workspaceRoot,
    opencodeWorkspaceRoot: process.env.OPENCODE_WORKSPACE_ROOT || workspaceRoot,
    model: process.env.AGENT_MODEL || "openai/gpt-4.1-mini",
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
  method: "GET" | "POST",
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
      // A full agent turn (several tool calls) can take a while.
      signal: AbortSignal.timeout(170_000),
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

  let current: string | null = null;
  try {
    const cfg = JSON.parse(await readFile(configPath, "utf8"));
    const header: string | undefined = cfg?.mcp?.[MCP_KEY]?.headers?.Authorization;
    current = header?.startsWith("Bearer ") ? header.slice(7) : null;
  } catch {
    // missing or unreadable → (re)write below
  }

  const now = Math.floor(Date.now() / 1000);
  const stillValid =
    current && verifyAgentToken(current, now + TOKEN_REFRESH_MARGIN_SECONDS) === userId;
  if (stillValid) return opencodeDir;

  const { token } = signAgentToken(userId, now);
  await mkdir(localDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(buildOpencodeConfig(token, e), null, 2), { mode: 0o600 });
  if (current) {
    // A running instance cached the old config — drop it so the new token loads.
    await api(e, "POST", "/instance/dispose", opencodeDir).catch(() => {});
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
const modelRef = (e: Env): ModelRef => {
  const [providerID, ...rest] = e.model.split("/");
  return { providerID, modelID: rest.join("/") };
};

const SESSION_PERMISSIONS = [
  { permission: "*", pattern: "*", action: "deny" },
  { permission: `${MCP_KEY}_*`, pattern: "*", action: "allow" },
];

/** Tool switches sent with every prompt: nothing but finmon tools. */
const PROMPT_TOOLS = { "*": false, [`${MCP_KEY}_*`]: true };

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
type RawMessage = {
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
};

/** Marks messages finmon posts on the user's behalf (proposal decisions). */
const NOTE_PREFIX = "[finmon] ";

function toAgentMessage(m: RawMessage): AgentMessage | null {
  const texts = m.parts.filter((p) => p.type === "text" && p.text && !p.synthetic).map((p) => p.text!);
  const text = texts.join("\n\n").trim();
  if (m.info.role === "user" && text.startsWith(NOTE_PREFIX)) return null;

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
  if (!text && tools.length === 0 && !err) return null;
  return { id: m.info.id, role: m.info.role, createdAt: m.info.time.created, text, tools, error: err };
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

/** Send the user's message and wait for the whole agent turn to finish. */
export async function sendAgentPrompt(userId: string, sessionId: string, text: string): Promise<void> {
  const e = env();
  const directory = await ensureUserInstance(userId, e);
  await assertToolLockdown(e, directory);
  const today = new Date().toISOString().slice(0, 10);
  await api(e, "POST", `/session/${encodeURIComponent(sessionId)}/message`, directory, {
    agent: AGENT_NAME,
    model: modelRef(e),
    tools: PROMPT_TOOLS,
    system: `Today is ${today}.`,
    parts: [{ type: "text", text }],
  });
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
    model: modelRef(e),
    tools: PROMPT_TOOLS,
    noReply: true,
    parts: [{ type: "text", text: NOTE_PREFIX + note }],
  });
}
