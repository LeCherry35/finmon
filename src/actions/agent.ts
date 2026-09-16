"use server";

import { pool } from "@/db";
import { requireUser } from "@/lib/dal";
import {
  decideProposal,
  getProposals,
  type AgentProposal,
} from "@/lib/agent-proposals";
import {
  AgentUnavailableError,
  createAgentSession,
  getAgentMessages,
  noteProposalDecision,
  sendAgentPrompt,
  type AgentMessage,
} from "@/lib/opencode";

export type AgentChatSummary = { id: number; title: string | null; created_at: string };

export type AgentChatState = {
  chatId: number;
  messages: AgentMessage[];
  /** Proposals referenced by the messages' tool calls, keyed by id. */
  proposals: Record<number, AgentProposal>;
};

export type AgentResult<T> = { ok: true; data: T } | { ok: false; error: string };

const MAX_MESSAGE_LENGTH = 2000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PROMPTS = 10;

// In-memory, per process — matches Better Auth's in-memory rate limit (single
// app container). Blunts accidental loops and cost blow-ups, not a hard quota.
const recentPrompts = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (recentPrompts.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX_PROMPTS) {
    recentPrompts.set(userId, recent);
    return true;
  }
  recent.push(now);
  recentPrompts.set(userId, recent);
  return false;
}

async function guard<T>(fn: () => Promise<T>): Promise<AgentResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof AgentUnavailableError) return { ok: false, error: err.message };
    console.error("Agent action failed:", err instanceof Error ? err.stack ?? err.message : err);
    return { ok: false, error: "Something went wrong with the assistant." };
  }
}

async function ownedChat(userId: string, chatId: number) {
  if (!Number.isInteger(chatId) || chatId <= 0) return null;
  const { rows } = await pool.query<{ id: number; opencode_session_id: string }>(
    "SELECT id, opencode_session_id FROM agent_chats WHERE id = $1 AND user_id = $2",
    [chatId, userId],
  );
  return rows[0] ?? null;
}

async function chatState(userId: string, chatId: number, sessionId: string): Promise<AgentChatState> {
  const messages = await getAgentMessages(userId, sessionId);
  const ids = messages.flatMap((m) => m.tools.map((t) => t.proposalId)).filter((id): id is number => id !== null);
  const proposals = Object.fromEntries((await getProposals(userId, ids)).map((p) => [p.id, p]));
  return { chatId, messages, proposals };
}

function validText(raw: string): string | { error: string } {
  const text = (raw ?? "").trim();
  if (!text) return { error: "Type a message" };
  if (text.length > MAX_MESSAGE_LENGTH) return { error: `Keep it under ${MAX_MESSAGE_LENGTH} characters` };
  return text;
}

export async function listAgentChats(): Promise<AgentChatSummary[]> {
  const { id: userId } = await requireUser();
  const { rows } = await pool.query<AgentChatSummary>(
    "SELECT id, title, created_at FROM agent_chats WHERE user_id = $1 ORDER BY id DESC LIMIT 30",
    [userId],
  );
  return rows;
}

export async function loadAgentChat(chatId: number): Promise<AgentResult<AgentChatState>> {
  const { id: userId } = await requireUser();
  const chat = await ownedChat(userId, chatId);
  if (!chat) return { ok: false, error: "Chat not found" };
  return guard(() => chatState(userId, chat.id, chat.opencode_session_id));
}

/** Send a message. With no chatId a new chat is started. Waits for the whole
 *  agent turn (no streaming) and returns the updated conversation. */
export async function sendAgentMessage(
  chatId: number | null,
  rawText: string,
): Promise<AgentResult<AgentChatState>> {
  const { id: userId } = await requireUser();
  const text = validText(rawText);
  if (typeof text === "object") return { ok: false, error: text.error };

  let chat = chatId === null ? null : await ownedChat(userId, chatId);
  if (chatId !== null && !chat) return { ok: false, error: "Chat not found" };
  if (rateLimited(userId)) return { ok: false, error: "Too many messages — wait a minute." };

  return guard(async () => {
    if (!chat) {
      const title = text.length > 60 ? `${text.slice(0, 57)}…` : text;
      const sessionId = await createAgentSession(userId, title);
      const { rows } = await pool.query<{ id: number; opencode_session_id: string }>(
        `INSERT INTO agent_chats (user_id, opencode_session_id, title)
         VALUES ($1, $2, $3) RETURNING id, opencode_session_id`,
        [userId, sessionId, title],
      );
      chat = rows[0];
    }
    await sendAgentPrompt(userId, chat.opencode_session_id, text);
    return chatState(userId, chat.id, chat.opencode_session_id);
  });
}

async function decide(
  chatId: number,
  proposalId: number,
  decision: "accept" | "reject",
): Promise<AgentResult<AgentChatState>> {
  const { id: userId } = await requireUser();
  const chat = await ownedChat(userId, chatId);
  if (!chat) return { ok: false, error: "Chat not found" };
  if (!Number.isInteger(proposalId) || proposalId <= 0) return { ok: false, error: "Invalid proposal" };

  const result = await decideProposal(userId, proposalId, decision);
  if (!result.ok) return result;

  const p = result.proposal;
  const note =
    p.status === "accepted"
      ? `The user ACCEPTED proposal ${p.id} (${p.tool}); it has been applied.`
      : p.status === "rejected"
        ? `The user REJECTED proposal ${p.id} (${p.tool}); nothing was changed.`
        : `The user accepted proposal ${p.id} (${p.tool}) but applying it FAILED: ${p.error}. Nothing was changed.`;

  return guard(async () => {
    // The decision is already recorded; failing to inform the agent shouldn't
    // surface as an error for the user.
    await noteProposalDecision(userId, chat.opencode_session_id, note).catch((err) =>
      console.error("Could not note proposal decision:", err),
    );
    return chatState(userId, chat.id, chat.opencode_session_id);
  });
}

export async function acceptProposal(chatId: number, proposalId: number) {
  return decide(chatId, proposalId, "accept");
}

export async function rejectProposal(chatId: number, proposalId: number) {
  return decide(chatId, proposalId, "reject");
}
