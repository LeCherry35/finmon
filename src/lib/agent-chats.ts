import "server-only";
import { pool } from "@/db";
import { effectiveModel } from "@/lib/agent-models";
import { decideProposal, getProposals, type AgentProposal } from "@/lib/agent-proposals";
import {
  AgentUnavailableError,
  getAgentMessages,
  isSessionBusy,
  noteProposalDecision,
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
  /** The model the chat's next message runs on (stored choice if still offered, else the default). */
  model: string;
};

export type AgentResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const STILL_RUNNING = "The assistant is still answering. Wait, or stop it first.";

/** opencode reports a just-started turn as busy only after a moment, so a
 *  trailing user message younger than this means "starting", not "failed". */
const TURN_START_GRACE_MS = 10_000;

/** Shown when a turn ended without writing anything: opencode gave up before
 *  it created the assistant message (an unresolvable model, a crash), so the
 *  chat would otherwise sit there with no reply and no error at all. */
export const NO_REPLY = "The assistant didn't reply — the turn failed. Try sending it again.";

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

export async function chatState(
  userId: string,
  chatId: number,
  sessionId: string,
  storedModel: string | null = null,
): Promise<AgentChatState> {
  const [messages, running] = await Promise.all([
    getAgentMessages(userId, sessionId),
    isSessionBusy(userId, sessionId),
  ]);
  const ids = proposalIds(messages);
  if (ids.length > 0) {
    // The messages say which chat made these; fills in what creation missed.
    await pool.query(
      `UPDATE agent_proposals SET chat_id = $1
       WHERE user_id = $2 AND id = ANY($3::int[]) AND chat_id IS NULL`,
      [chatId, userId, ids],
    );
  }
  const proposals = Object.fromEntries((await getProposals(userId, ids)).map((p) => [p.id, p]));
  return {
    chatId,
    ...withDeadTurn(messages, running),
    proposals,
    model: effectiveModel(storedModel),
  };
}

/**
 * A chat whose last visible message is the user's, with nothing running, is a
 * turn that died without a reply. Within the grace period it is reported as
 * still running instead, so the page keeps polling rather than declaring a
 * turn dead that opencode simply hasn't picked up yet.
 *
 * Exported for tests.
 */
export function withDeadTurn(
  messages: AgentMessage[],
  running: boolean,
  now = Date.now(),
): { messages: AgentMessage[]; running: boolean } {
  const last = messages.at(-1);
  if (running || last?.role !== "user") return { messages, running };
  if (now - last.createdAt < TURN_START_GRACE_MS) return { messages, running: true };
  return {
    messages: [
      ...messages,
      {
        id: `${last.id}-no-reply`,
        role: "assistant",
        createdAt: last.createdAt,
        text: "",
        tools: [],
        error: NO_REPLY,
        attachmentId: null,
      },
    ],
    running: false,
  };
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

/**
 * Accept or reject a proposal, from its chat or the Suggestions page. Refused
 * while the proposal's chat has a turn running (posting the note into a busy
 * session isn't safe); afterwards the agent is told the outcome in that chat.
 * A proposal with no known (or a deleted) chat is decided without a note.
 */
export async function decideWithNote(
  userId: string,
  proposalId: number,
  decision: "accept" | "reject",
): Promise<AgentResult<AgentProposal>> {
  const { rows } = await pool.query<{ session: string | null }>(
    `SELECT c.opencode_session_id AS session FROM agent_proposals p
     LEFT JOIN agent_chats c ON c.id = p.chat_id AND c.deleted_at IS NULL
     WHERE p.id = $1 AND p.user_id = $2`,
    [proposalId, userId],
  );
  if (!rows[0]) return { ok: false, error: "Proposal not found" };
  const session = rows[0].session;
  if (session && (await isSessionBusy(userId, session).catch(() => false))) {
    return { ok: false, error: STILL_RUNNING };
  }

  const result = await decideProposal(userId, proposalId, decision);
  if (!result.ok) return result;

  const p = result.proposal;
  if (session) {
    const note =
      p.status === "accepted"
        ? `The user ACCEPTED proposal ${p.id} (${p.tool}); it has been applied.`
        : p.status === "rejected"
          ? `The user REJECTED proposal ${p.id} (${p.tool}); nothing was changed.`
          : `The user accepted proposal ${p.id} (${p.tool}) but applying it FAILED: ${p.error}. Nothing was changed.`;
    // The decision is already recorded; failing to inform the agent shouldn't
    // surface as an error for the user.
    await noteProposalDecision(userId, session, note).catch((err) =>
      console.error("Could not note proposal decision:", err),
    );
  }
  return { ok: true, data: p };
}
