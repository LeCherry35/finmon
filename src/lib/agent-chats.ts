import "server-only";
import { pool } from "@/db";
import { getProposals, type AgentProposal } from "@/lib/agent-proposals";
import {
  AgentUnavailableError,
  getAgentMessages,
  isSessionBusy,
  type AgentMessage,
} from "@/lib/opencode";

// Assistant chat helpers for the server actions (src/actions/agent.ts). They
// take an explicit userId, so they must never be exported from a "use server"
// module.

export type AgentChatState = {
  chatId: number;
  messages: AgentMessage[];
  /** Proposals referenced by the messages' tool calls, keyed by id. */
  proposals: Record<number, AgentProposal>;
  /** The agent is still working on a turn (the page polls until it's done). */
  running: boolean;
};

export type AgentResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function guard<T>(fn: () => Promise<T>): Promise<AgentResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof AgentUnavailableError) return { ok: false, error: err.message };
    console.error("Agent action failed:", err instanceof Error ? err.stack ?? err.message : err);
    return { ok: false, error: "Something went wrong with the assistant." };
  }
}

export function proposalIds(messages: AgentMessage[]): number[] {
  return messages.flatMap((m) => m.tools.map((t) => t.proposalId)).filter((id): id is number => id !== null);
}

export async function chatState(userId: string, chatId: number, sessionId: string): Promise<AgentChatState> {
  const [messages, running] = await Promise.all([
    getAgentMessages(userId, sessionId),
    isSessionBusy(userId, sessionId),
  ]);
  const ids = proposalIds(messages);
  const proposals = Object.fromEntries((await getProposals(userId, ids)).map((p) => [p.id, p]));
  return { chatId, messages, proposals, running };
}

/** Reject proposals nothing can accept any more (deleted chat or stopped turn). */
export async function rejectPendingProposals(userId: string, ids: number[]) {
  if (ids.length === 0) return;
  await pool.query(
    `UPDATE agent_proposals SET status = 'rejected', decided_at = now()
     WHERE user_id = $1 AND id = ANY($2::int[]) AND status = 'pending'`,
    [userId, ids],
  );
}
