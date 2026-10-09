import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AGENT_TOOLS } from "@/lib/agent-tools";

/** The tools as MCP `tools/list` returns them. */
export const MCP_TOOL_LIST = AGENT_TOOLS.map((t) => {
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

/** Fingerprint of MCP_TOOL_LIST. opencode lists an MCP server's tools once per
 *  instance, so it goes into each user's config: a changed toolset changes the
 *  config, which disposes the instance and makes it list them again. */
export const TOOLSET_VERSION = createHash("sha256").update(JSON.stringify(MCP_TOOL_LIST)).digest("hex").slice(0, 12);
