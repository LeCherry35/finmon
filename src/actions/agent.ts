"use server";

import { pool } from "@/db";
import { requireUser } from "@/lib/dal";
import { decideProposal } from "@/lib/agent-proposals";
import {
  chatState,
  guard,
  proposalIds,
  rejectPendingProposals,
  type AgentChatState as ChatState,
  type AgentResult as Result,
} from "@/lib/agent-chats";
import { parseImageDataUrl } from "@/lib/image-data-url";
import {
  AgentUnavailableError,
  abortAgentSession,
  attachmentMarker,
  createAgentSession,
  deleteLastTurn,
  getAgentMessages,
  isSessionBusy,
  noteProposalDecision,
  sendAgentPrompt,
  waitUntilIdle,
} from "@/lib/opencode";

// Declared as aliases, not `export type { … }`: in a "use server" file the
// bundler treats re-exported names as server actions (build error).
export type AgentChatState = ChatState;
export type AgentResult<T> = Result<T>;
export type AgentChatSummary = { id: number; title: string | null; created_at: string };
/** What Stop undid: the chat as it is now (null: the chat was removed, it only
 *  held the stopped message) and the stopped message, to put back in the composer. */
export type StoppedTurn = { state: AgentChatState | null; text: string; attachmentId: number | null };

const MAX_MESSAGE_LENGTH = 2000;
/** Server actions accept 4 MB bodies (next.config.ts); the client downscales
 *  photos to a few hundred KB, so this only stops abuse. */
const MAX_IMAGE_DATA_URL_LENGTH = 3_500_000;
const RECEIPT_CHAT_TITLE = "Receipt scan";
const STILL_RUNNING = "The assistant is still answering. Wait, or stop it first.";

type ChatRow = { id: number; opencode_session_id: string };
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

async function ownedChat(userId: string, chatId: number) {
  if (!Number.isInteger(chatId) || chatId <= 0) return null;
  const { rows } = await pool.query<{ id: number; opencode_session_id: string }>(
    "SELECT id, opencode_session_id FROM agent_chats WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    [chatId, userId],
  );
  return rows[0] ?? null;
}

function validText(raw: string, allowEmpty = false): string | { error: string } {
  const text = (raw ?? "").trim();
  if (!text && !allowEmpty) return { error: "Type a message" };
  if (text.length > MAX_MESSAGE_LENGTH) return { error: `Keep it under ${MAX_MESSAGE_LENGTH} characters` };
  return text;
}

export async function listAgentChats(): Promise<AgentChatSummary[]> {
  const { id: userId } = await requireUser();
  const { rows } = await pool.query<AgentChatSummary>(
    `SELECT id, title, created_at FROM agent_chats
     WHERE user_id = $1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 30`,
    [userId],
  );
  return rows;
}

/** Hide a chat from the user. The row and the opencode session are kept for
 *  the record; proposals it left pending are rejected, since nothing can
 *  accept them any more. */
export async function deleteAgentChat(chatId: number): Promise<AgentResult<null>> {
  const { id: userId } = await requireUser();
  const chat = await ownedChat(userId, chatId);
  if (!chat) return { ok: false, error: "Chat not found" };

  await pool.query(
    "UPDATE agent_chats SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    [chat.id, userId],
  );

  try {
    const messages = await getAgentMessages(userId, chat.opencode_session_id);
    await rejectPendingProposals(userId, proposalIds(messages));
  } catch (err) {
    console.error("Could not clean up proposals of deleted chat:", err);
  }
  return { ok: true, data: null };
}

export async function loadAgentChat(chatId: number): Promise<AgentResult<AgentChatState>> {
  const { id: userId } = await requireUser();
  const chat = await ownedChat(userId, chatId);
  if (!chat) return { ok: false, error: "Chat not found" };
  return guard(() => chatState(userId, chat.id, chat.opencode_session_id));
}

/** Send a message. With no chatId a new chat is started. Only *starts* the
 *  agent's turn: it runs on in opencode whether or not the page stays open, and
 *  the returned state has `running: true` — the page polls loadAgentChat until
 *  the reply is in.
 *
 *  `image` (a `data:image/…` URL) attaches a receipt photo: it's stored in
 *  agent_attachments, the agent only gets an "[Image attached: receipt #id]"
 *  marker, and the turn runs in receipt mode (scan_receipt + create_transaction
 *  only). The text is optional then. */
export async function sendAgentMessage(
  chatId: number | null,
  rawText: string,
  image?: string | null,
): Promise<AgentResult<AgentChatState>> {
  const { id: userId } = await requireUser();
  const text = validText(rawText, !!image);
  if (typeof text === "object") return { ok: false, error: text.error };
  let photo: ReturnType<typeof parseImageDataUrl> = null;
  if (image) {
    if (image.length > MAX_IMAGE_DATA_URL_LENGTH) return { ok: false, error: "That photo is too large" };
    photo = parseImageDataUrl(image);
    if (!photo) return { ok: false, error: "That file isn't an image" };
  }

  let chat = chatId === null ? null : await ownedChat(userId, chatId);
  if (chatId !== null && !chat) return { ok: false, error: "Chat not found" };
  if (rateLimited(userId)) return { ok: false, error: "Too many messages — wait a minute." };

  return guard(async () => {
    if (chat && (await isSessionBusy(userId, chat.opencode_session_id))) {
      throw new AgentUnavailableError(STILL_RUNNING);
    }
    if (!chat) {
      const title = !text ? RECEIPT_CHAT_TITLE : text.length > 60 ? `${text.slice(0, 57)}…` : text;
      const sessionId = await createAgentSession(userId, title);
      const { rows } = await pool.query<ChatRow>(
        `INSERT INTO agent_chats (user_id, opencode_session_id, title)
         VALUES ($1, $2, $3) RETURNING id, opencode_session_id`,
        [userId, sessionId, title],
      );
      chat = rows[0];
    }

    if (!photo) {
      await sendAgentPrompt(userId, chat.opencode_session_id, text);
    } else {
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO agent_attachments (user_id, chat_id, image, content_type)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [userId, chat.id, photo.bytes, photo.contentType],
      );
      const marker = attachmentMarker(rows[0].id);
      const prompt = text ? `${text}\n\n${marker}` : marker;
      await sendAgentPrompt(userId, chat.opencode_session_id, prompt, "receipt");
    }
    // opencode may not report the session busy for a moment after accepting
    // the prompt — the turn was just started, so it is running.
    return { ...(await chatState(userId, chat.id, chat.opencode_session_id)), running: true };
  });
}

/** Stop the chat's running turn and undo it: abort it in opencode, then delete
 *  the user's message and whatever the agent wrote in reply, and reject the
 *  proposals it made — the chat is back where it was before that send. A chat
 *  left empty (its first message was stopped) is removed. */
export async function stopAgentMessage(chatId: number): Promise<AgentResult<StoppedTurn>> {
  const { id: userId } = await requireUser();
  const chat = await ownedChat(userId, chatId);
  if (!chat) return { ok: false, error: "Chat not found" };

  return guard(async () => {
    const sessionId = chat.opencode_session_id;
    if (!(await isSessionBusy(userId, sessionId))) {
      throw new AgentUnavailableError("Already finished");
    }
    await abortAgentSession(userId, sessionId);
    await waitUntilIdle(userId, sessionId);
    const undone = await deleteLastTurn(userId, sessionId);
    await rejectPendingProposals(userId, undone.proposalIds);

    let state: AgentChatState | null = null;
    if (undone.remaining === 0) {
      await pool.query(
        "UPDATE agent_chats SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        [chat.id, userId],
      );
    } else {
      state = await chatState(userId, chat.id, sessionId);
    }
    return { state, text: undone.text, attachmentId: undone.attachmentId };
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
  // Posting the decision note into a session mid-turn isn't safe; the UI
  // disables Accept/Reject until the turn ends.
  if (await isSessionBusy(userId, chat.opencode_session_id).catch(() => false)) {
    return { ok: false, error: STILL_RUNNING };
  }

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
