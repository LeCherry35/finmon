import { z } from "zod";
import { verifyAgentToken } from "@/lib/agent-token";
import { AGENT_TOOLS } from "@/lib/agent-tools";
import { callAgentTool } from "@/lib/agent-proposals";

/**
 * The agent's MCP server: Streamable HTTP transport, stateless, JSON responses
 * only (no SSE stream — every method here answers immediately). Called by the
 * opencode sidecar over the private Docker network; nginx refuses this path
 * publicly. Excluded from src/proxy.ts (no session cookie — auth is the bearer
 * token, which maps to exactly one user).
 *
 * Implements just what a tools-only server needs: initialize, ping,
 * tools/list, tools/call, and accepts notifications.
 */

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: unknown };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const rpcError = (id: JsonRpcRequest["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

const TOOL_LIST = AGENT_TOOLS.map((t) => {
  const inputSchema = z.toJSONSchema(t.input) as Record<string, unknown>;
  delete inputSchema.$schema;
  return {
    name: t.name,
    description: t.requiresApproval
      ? `${t.description} Requires the user's approval: the call only creates a pending proposal.`
      : t.description,
    inputSchema,
    annotations: { readOnlyHint: !t.requiresApproval },
  };
});

async function handle(userId: string, msg: JsonRpcRequest) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize": {
      const requested = (params as { protocolVersion?: string } | undefined)?.protocolVersion;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion:
            requested && SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "finmon", version: process.env.npm_package_version ?? "0" },
          instructions:
            "Tools over the signed-in user's finmon records. Read tools answer immediately. Write tools only create proposals the user must accept in the chat.",
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOL_LIST } };
    case "tools/call": {
      const p = params as { name?: unknown; arguments?: unknown } | undefined;
      if (typeof p?.name !== "string") return rpcError(id, -32602, "Missing tool name");
      const result = await callAgentTool(userId, p.name, p.arguments);
      return {
        jsonrpc: "2.0",
        id,
        result: result.ok
          ? { content: [{ type: "text", text: JSON.stringify(result.data) }] }
          : { content: [{ type: "text", text: result.error }], isError: true },
      };
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const userId = auth.startsWith("Bearer ") ? verifyAgentToken(auth.slice(7).trim()) : null;
  if (!userId) return json({ error: "Unauthorized" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }

  const messages = (Array.isArray(body) ? body : [body]) as JsonRpcRequest[];
  if (messages.length === 0 || messages.some((m) => !m || typeof m.method !== "string")) {
    return json(rpcError(null, -32600, "Invalid request"), 400);
  }

  // Notifications (no id) get no response; a batch of only notifications → 202.
  const requests = messages.filter((m) => m.id !== undefined && m.id !== null);
  if (requests.length === 0) return new Response(null, { status: 202 });

  const responses = [];
  for (const m of requests) responses.push(await handle(userId, m));
  return json(Array.isArray(body) ? responses : responses[0]);
}

// No server-initiated stream and no sessions to terminate.
export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
