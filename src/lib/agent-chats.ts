import "server-only";
import { pool } from "@/db";
import { effectiveModel } from "@/lib/agent-models";
import { decideProposal, getProposals, type AgentProposal } from "@/lib/agent-proposals";
import {
  AgentUnavailableError,
  busySessionIds,
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

  if (session) await noteDecisions(userId, session, [result.proposal]);
  return { ok: true, data: result.proposal };
}

/**
 * Accept or reject every pending proposal (the Suggestions page's "all"
 * buttons): accepts apply oldest first, a failure doesn't stop the rest.
 * Refused while any of their chats is running; each chat then gets one note.
 */
export async function decideAllPending(
  userId: string,
  decision: "accept" | "reject",
): Promise<AgentResult<AgentProposal[]>> {
  const { rows: pending } = await pool.query<{ id: number; session: string | null }>(
    `SELECT p.id, c.opencode_session_id AS session FROM agent_proposals p
     LEFT JOIN agent_chats c ON c.id = p.chat_id AND c.deleted_at IS NULL
     WHERE p.user_id = $1 AND p.status = 'pending'
     ORDER BY p.created_at, p.id`,
    [userId],
  );
  if (pending.length === 0) return { ok: true, data: [] };
  const busy = await busySessionIds(userId).catch(() => new Set<string>());
  if (pending.some((p) => p.session && busy.has(p.session))) return { ok: false, error: STILL_RUNNING };

  let decided: AgentProposal[] = [];
  if (decision === "reject") {
    ({ rows: decided } = await pool.query<AgentProposal>(
      `UPDATE agent_proposals SET status = 'rejected', decided_at = now()
       WHERE user_id = $1 AND id = ANY($2::int[]) AND status = 'pending'
       RETURNING id, chat_id, tool, args, summary, status, error, created_at, decided_at`,
      [userId, pending.map((p) => p.id)],
    ));
  } else {
    for (const { id } of pending) {
      const r = await decideProposal(userId, id, "accept");
      if (r.ok) decided.push(r.proposal); // !ok: decided meanwhile elsewhere
    }
  }

  const sessionOf = new Map(pending.map((p) => [p.id, p.session]));
  const bySession = Map.groupBy(
    decided.filter((p) => sessionOf.get(p.id)),
    (p) => sessionOf.get(p.id)!,
  );
  for (const [session, ps] of bySession) await noteDecisions(userId, session, ps);
  return { ok: true, data: decided };
}

/** Tell the agent, in its chat, how the user decided these proposals. */
async function noteDecisions(userId: string, session: string, ps: AgentProposal[]) {
  const label = (xs: AgentProposal[]) =>
    xs.length === 1 ? `proposal ${xs[0].id} (${xs[0].tool})` : `proposals ${xs.map((p) => p.id).join(", ")}`;
  const accepted = ps.filter((p) => p.status === "accepted");
  const rejected = ps.filter((p) => p.status === "rejected");
  const failed = ps.filter((p) => p.status === "failed");
  const note = [
    accepted.length > 0 && `The user ACCEPTED ${label(accepted)}; ${accepted.length === 1 ? "it has" : "they have"} been applied.`,
    rejected.length > 0 && `The user REJECTED ${label(rejected)}; nothing was changed.`,
    ...failed.map((p) => `The user accepted ${label([p])} but applying it FAILED: ${p.error}. Nothing was changed.`),
  ]
    .filter(Boolean)
    .join(" ");
  // The decision is already recorded; failing to inform the agent shouldn't
  // surface as an error for the user.
  await noteProposalDecision(userId, session, note).catch((err) =>
    console.error("Could not note proposal decision:", err),
  );
}
