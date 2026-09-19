import "server-only";
import { pool } from "@/db";
import {
  AgentToolError,
  getAgentTool,
  parseToolInput,
} from "@/lib/agent-tools";
import { busySessionIds } from "@/lib/opencode";

/** More pending proposals than this and new write calls are refused, so a
 *  runaway agent can't bury the user in approval cards. */
export const MAX_PENDING_PROPOSALS = 20;

export type ProposalStatus = "pending" | "accepted" | "rejected" | "failed";

export type AgentProposal = {
  id: number;
  /** The chat it was proposed in, when known (see migration 019). */
  chat_id: number | null;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  status: ProposalStatus;
  error: string | null;
  created_at: string;
  decided_at: string | null;
};

export type ToolCallResult = { ok: true; data: unknown } | { ok: false; error: string };

/**
 * Handle one tool call from the agent for `userId` (taken from the verified MCP
 * token). Read tools run now; approval tools are validated, summarized and
 * stored as a pending proposal — nothing is written to the user's records.
 */
export async function callAgentTool(
  userId: string,
  name: string,
  rawInput: unknown,
): Promise<ToolCallResult> {
  const tool = getAgentTool(name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };

  try {
    const input = parseToolInput(tool, rawInput);

    if (!tool.requiresApproval) {
      return { ok: true, data: await tool.run(userId, input as never) };
    }

    if ((await countPendingProposals(userId)) >= MAX_PENDING_PROPOSALS) {
      return {
        ok: false,
        error: `There are already ${MAX_PENDING_PROPOSALS} changes waiting for the user's approval. Ask them to accept or reject those first.`,
      };
    }

    const summary = tool.describe ? await tool.describe(userId, input as never) : tool.name;
    const chatId = await runningChatId(userId);
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO agent_proposals (user_id, tool, args, summary, chat_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, tool.name, JSON.stringify(input), summary, chatId],
    );
    return {
      ok: true,
      data: {
        status: "pending_user_approval",
        proposal_id: rows[0].id,
        summary,
        message:
          "Not applied yet. The user sees this change as a card with Accept / Reject buttons. Do not say it was done.",
      },
    };
  } catch (err) {
    if (err instanceof AgentToolError) return { ok: false, error: err.message };
    console.error(`Agent tool ${name} failed:`, err instanceof Error ? err.stack ?? err.message : err);
    return { ok: false, error: "Internal error while running the tool" };
  }
}

/** The chat whose turn is making this tool call: the user's only chat with a
 *  running turn. Null when that's ambiguous or unknown — chatState links the
 *  proposal later, when its chat is opened. */
async function runningChatId(userId: string): Promise<number | null> {
  try {
    const busy = await busySessionIds(userId);
    if (busy.size === 0) return null;
    const { rows } = await pool.query<{ id: number; opencode_session_id: string }>(
      "SELECT id, opencode_session_id FROM agent_chats WHERE user_id = $1 AND deleted_at IS NULL",
      [userId],
    );
    const running = rows.filter((c) => busy.has(c.opencode_session_id));
    return running.length === 1 ? running[0].id : null;
  } catch (err) {
    console.error("Could not find the proposing chat:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function countPendingProposals(userId: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM agent_proposals WHERE user_id = $1 AND status = 'pending'",
    [userId],
  );
  return rows[0]?.count ?? 0;
}

/** A proposal as the Suggestions page lists it: with its chat's title. */
export type SuggestionItem = AgentProposal & { chat_title: string | null };

export const SUGGESTION_HISTORY_LIMIT = 50;

/** Every pending proposal (newest first) and the latest decided ones. */
export async function listProposals(
  userId: string,
): Promise<{ pending: SuggestionItem[]; history: SuggestionItem[] }> {
  const select = `SELECT p.id, p.chat_id, p.tool, p.args, p.summary, p.status, p.error,
                         p.created_at, p.decided_at, c.title AS chat_title
                  FROM agent_proposals p
                  LEFT JOIN agent_chats c ON c.id = p.chat_id AND c.deleted_at IS NULL
                  WHERE p.user_id = $1`;
  const [pending, history] = await Promise.all([
    pool.query<SuggestionItem>(`${select} AND p.status = 'pending' ORDER BY p.id DESC`, [userId]),
    pool.query<SuggestionItem>(
      `${select} AND p.status <> 'pending' ORDER BY p.decided_at DESC NULLS LAST, p.id DESC LIMIT $2`,
      [userId, SUGGESTION_HISTORY_LIMIT],
    ),
  ]);
  return { pending: pending.rows, history: history.rows };
}

/** The user's proposals by id (only their own), for rendering approval cards. */
export async function getProposals(userId: string, ids: number[]): Promise<AgentProposal[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<AgentProposal>(
    `SELECT id, chat_id, tool, args, summary, status, error, created_at, decided_at
     FROM agent_proposals WHERE user_id = $1 AND id = ANY($2::int[])`,
    [userId, ids],
  );
  return rows;
}

/**
 * Accept or reject a pending proposal. Accepting runs the tool (its input
 * re-validated) with the same shared mutation logic the UI uses. The row is
 * locked for the duration so a double click can't apply it twice.
 */
export async function decideProposal(
  userId: string,
  proposalId: number,
  decision: "accept" | "reject",
): Promise<{ ok: true; proposal: AgentProposal } | { ok: false; error: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<AgentProposal>(
      `SELECT id, chat_id, tool, args, summary, status, error, created_at, decided_at
       FROM agent_proposals WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [proposalId, userId],
    );
    const proposal = rows[0];
    if (!proposal) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Proposal not found" };
    }
    if (proposal.status !== "pending") {
      await client.query("ROLLBACK");
      return { ok: false, error: `Already ${proposal.status}` };
    }

    let status: ProposalStatus = "rejected";
    let error: string | null = null;
    if (decision === "accept") {
      const tool = getAgentTool(proposal.tool);
      try {
        if (!tool?.requiresApproval) throw new AgentToolError("Unknown tool");
        await tool.run(userId, parseToolInput(tool, proposal.args) as never);
        status = "accepted";
      } catch (err) {
        status = "failed";
        error = err instanceof AgentToolError ? err.message : "Could not apply the change";
        if (!(err instanceof AgentToolError)) {
          console.error(`Applying proposal ${proposalId} failed:`, err instanceof Error ? err.stack ?? err.message : err);
        }
      }
    }

    const { rows: updated } = await client.query<AgentProposal>(
      `UPDATE agent_proposals SET status = $1, error = $2, decided_at = now()
       WHERE id = $3 AND user_id = $4
       RETURNING id, chat_id, tool, args, summary, status, error, created_at, decided_at`,
      [status, error, proposalId, userId],
    );
    await client.query("COMMIT");
    return { ok: true, proposal: updated[0] };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
