import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_USER_ID } from "../../test/helpers";

const { query, decideProposal, getProposals, oc } = vi.hoisted(() => ({
  query: vi.fn(),
  decideProposal: vi.fn(),
  getProposals: vi.fn(),
  oc: {
    abortAgentSession: vi.fn(),
    createAgentSession: vi.fn(),
    deleteLastTurn: vi.fn(),
    getAgentMessages: vi.fn(),
    isSessionBusy: vi.fn(),
    noteProposalDecision: vi.fn(),
    sendAgentPrompt: vi.fn(),
    waitUntilIdle: vi.fn(),
  },
}));

vi.mock("@/db", () => ({ pool: { query } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dal", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/agent-proposals", () => ({ decideProposal, getProposals }));
vi.mock("@/lib/opencode", () => ({
  ...oc,
  AgentUnavailableError: class AgentUnavailableError extends Error {},
  attachmentMarker: (id: number) => `[Image attached: receipt #${id}]`,
}));

import {
  acceptProposal,
  deleteAgentChat,
  listAgentChats,
  loadAgentChat,
  rejectProposal,
  sendAgentMessage,
  stopAgentMessage,
} from "@/actions/agent";

const chatRow = { id: 5, opencode_session_id: "ses_1" };

beforeEach(() => {
  query.mockReset();
  decideProposal.mockReset();
  getProposals.mockReset().mockResolvedValue([]);
  for (const fn of Object.values(oc)) fn.mockReset();
  oc.getAgentMessages.mockResolvedValue([]);
  oc.isSessionBusy.mockResolvedValue(false);
});

describe("sendAgentMessage", () => {
  it.each([
    ["", "Type a message"],
    ["   ", "Type a message"],
    ["x".repeat(2001), "Keep it under 2000 characters"],
  ])("rejects invalid text (%#)", async (text, error) => {
    expect(await sendAgentMessage(null, text)).toEqual({ ok: false, error });
    expect(oc.sendAgentPrompt).not.toHaveBeenCalled();
  });

  it("refuses a chat the user doesn't own", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await sendAgentMessage(5, "hi")).toEqual({ ok: false, error: "Chat not found" });
    expect(query.mock.calls[0][1]).toEqual([5, TEST_USER_ID]);
    expect(oc.sendAgentPrompt).not.toHaveBeenCalled();
  });

  it("starts a new chat, records it for the user, and prompts it", async () => {
    oc.createAgentSession.mockResolvedValue("ses_new");
    query.mockResolvedValueOnce({ rows: [{ id: 7, opencode_session_id: "ses_new" }] });

    const result = await sendAgentMessage(null, "How much did I spend?");

    expect(oc.createAgentSession).toHaveBeenCalledWith(TEST_USER_ID, "How much did I spend?");
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO agent_chats/);
    expect(query.mock.calls[0][1]).toEqual([TEST_USER_ID, "ses_new", "How much did I spend?"]);
    expect(oc.sendAgentPrompt).toHaveBeenCalledWith(TEST_USER_ID, "ses_new", "How much did I spend?");
    // Only starts the turn: it's reported running even before opencode says busy.
    expect(result).toEqual({ ok: true, data: { chatId: 7, messages: [], proposals: {}, running: true } });
  });

  it("stores an attached photo and prompts in receipt mode with only a marker", async () => {
    query
      .mockResolvedValueOnce({ rows: [chatRow] }) // ownedChat
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }); // INSERT agent_attachments

    const result = await sendAgentMessage(5, "  ", "data:image/jpeg;base64,AAAA");

    expect(result.ok).toBe(true);
    expect(query.mock.calls[1][0]).toMatch(/INSERT INTO agent_attachments/);
    expect(query.mock.calls[1][1]).toEqual([TEST_USER_ID, 5, Buffer.from("AAAA", "base64"), "image/jpeg"]);
    expect(oc.sendAgentPrompt).toHaveBeenCalledWith(TEST_USER_ID, "ses_1", "[Image attached: receipt #42]", "receipt");
  });

  it("keeps the user's text before the marker, and titles an image-only chat", async () => {
    oc.createAgentSession.mockResolvedValue("ses_new");
    query
      .mockResolvedValueOnce({ rows: [{ id: 7, opencode_session_id: "ses_new" }] })
      .mockResolvedValueOnce({ rows: [{ id: 43 }] });
    await sendAgentMessage(null, "", "data:image/png;base64,AAAA");
    expect(oc.createAgentSession).toHaveBeenCalledWith(TEST_USER_ID, "Receipt scan");

    query.mockResolvedValueOnce({ rows: [chatRow] }).mockResolvedValueOnce({ rows: [{ id: 44 }] });
    await sendAgentMessage(5, "category Food", "data:image/png;base64,AAAA");
    expect(oc.sendAgentPrompt).toHaveBeenLastCalledWith(
      TEST_USER_ID,
      "ses_1",
      "category Food\n\n[Image attached: receipt #44]",
      "receipt",
    );
  });

  it.each([
    ["data:text/plain;base64,AAAA", "That file isn't an image"],
    ["data:image/jpeg;base64," + "A".repeat(3_500_000), "That photo is too large"],
  ])("rejects a bad image (%#)", async (image, error) => {
    expect(await sendAgentMessage(null, "", image)).toEqual({ ok: false, error });
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses to send into a chat whose turn is still running", async () => {
    query.mockResolvedValueOnce({ rows: [chatRow] });
    oc.isSessionBusy.mockResolvedValue(true);
    expect(await sendAgentMessage(5, "two")).toEqual({
      ok: false,
      error: "The assistant is still answering. Wait, or stop it first.",
    });
    expect(oc.isSessionBusy).toHaveBeenCalledWith(TEST_USER_ID, "ses_1");
    expect(oc.sendAgentPrompt).not.toHaveBeenCalled();
  });

  it("attaches the user's proposals referenced by tool calls", async () => {
    query.mockResolvedValueOnce({ rows: [chatRow] });
    oc.getAgentMessages.mockResolvedValue([
      { id: "m1", role: "assistant", text: "", error: null, createdAt: 1, tools: [{ name: "delete_transaction", status: "completed", proposalId: 12, error: null }] },
    ]);
    getProposals.mockResolvedValue([{ id: 12, status: "pending" }]);

    const result = await sendAgentMessage(5, "delete it");

    expect(getProposals).toHaveBeenCalledWith(TEST_USER_ID, [12]);
    expect(result.ok && result.data.proposals).toEqual({ 12: { id: 12, status: "pending" } });
  });
});

describe("stopAgentMessage", () => {
  const undone = { proposalIds: [12], text: "delete everything", attachmentId: null, remaining: 2 };

  it("refuses a chat the user doesn't own", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await stopAgentMessage(5)).toEqual({ ok: false, error: "Chat not found" });
    expect(oc.abortAgentSession).not.toHaveBeenCalled();
  });

  it("reports a turn that already finished, without undoing anything", async () => {
    query.mockResolvedValueOnce({ rows: [chatRow] });
    expect(await stopAgentMessage(5)).toEqual({ ok: false, error: "Already finished" });
    expect(oc.abortAgentSession).not.toHaveBeenCalled();
    expect(oc.deleteLastTurn).not.toHaveBeenCalled();
  });

  it("aborts, waits, deletes the last turn and rejects its proposals", async () => {
    query.mockResolvedValueOnce({ rows: [chatRow] }).mockResolvedValue({ rows: [] });
    oc.isSessionBusy.mockResolvedValueOnce(true).mockResolvedValue(false);
    oc.deleteLastTurn.mockResolvedValue(undone);

    const result = await stopAgentMessage(5);

    expect(oc.abortAgentSession).toHaveBeenCalledWith(TEST_USER_ID, "ses_1");
    expect(oc.waitUntilIdle).toHaveBeenCalledWith(TEST_USER_ID, "ses_1");
    expect(oc.deleteLastTurn).toHaveBeenCalledWith(TEST_USER_ID, "ses_1");
    const reject = query.mock.calls.find(([sql]) => /UPDATE agent_proposals/.test(sql));
    expect(reject?.[1]).toEqual([TEST_USER_ID, [12]]);
    expect(result).toEqual({
      ok: true,
      data: {
        state: { chatId: 5, messages: [], proposals: {}, running: false },
        text: "delete everything",
        attachmentId: null,
      },
    });
  });

  it("removes a chat left empty (its first message was stopped)", async () => {
    query.mockResolvedValueOnce({ rows: [chatRow] }).mockResolvedValue({ rows: [] });
    oc.isSessionBusy.mockResolvedValueOnce(true);
    oc.deleteLastTurn.mockResolvedValue({ ...undone, proposalIds: [], remaining: 0, attachmentId: 42 });

    const result = await stopAgentMessage(5);

    const softDelete = query.mock.calls.find(([sql]) => /UPDATE agent_chats SET deleted_at/.test(sql));
    expect(softDelete?.[1]).toEqual([5, TEST_USER_ID]);
    expect(result).toEqual({ ok: true, data: { state: null, text: "delete everything", attachmentId: 42 } });
  });
});

describe("loadAgentChat", () => {
  it("refuses another user's chat", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await loadAgentChat(5)).toEqual({ ok: false, error: "Chat not found" });
    expect(oc.getAgentMessages).not.toHaveBeenCalled();
  });
});

describe("accept/reject", () => {
  /** The chat lookup finds chatRow; the proposal's chat lookup finds its session. */
  const db = () =>
    query.mockImplementation(async (sql: string) =>
      /FROM agent_proposals p/.test(sql) ? { rows: [{ session: "ses_1" }] } : { rows: [chatRow] },
    );

  it("refuses when the chat isn't the user's, without deciding", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await acceptProposal(5, 12)).toEqual({ ok: false, error: "Chat not found" });
    expect(decideProposal).not.toHaveBeenCalled();
  });

  it("decides as the signed-in user and tells the agent the outcome", async () => {
    db();
    decideProposal.mockResolvedValue({ ok: true, proposal: { id: 12, tool: "delete_transaction", status: "rejected" } });
    oc.noteProposalDecision.mockResolvedValue(undefined);

    const result = await rejectProposal(5, 12);

    expect(decideProposal).toHaveBeenCalledWith(TEST_USER_ID, 12, "reject");
    expect(oc.noteProposalDecision).toHaveBeenCalledWith(TEST_USER_ID, "ses_1", expect.stringMatching(/REJECTED proposal 12/));
    expect(result.ok).toBe(true);
  });

  it("refuses while the chat's turn is still running", async () => {
    db();
    oc.isSessionBusy.mockResolvedValue(true);
    expect(await acceptProposal(5, 12)).toEqual({
      ok: false,
      error: "The assistant is still answering. Wait, or stop it first.",
    });
    expect(decideProposal).not.toHaveBeenCalled();
  });

  it("passes through a decision error", async () => {
    db();
    decideProposal.mockResolvedValue({ ok: false, error: "Already accepted" });
    expect(await acceptProposal(5, 12)).toEqual({ ok: false, error: "Already accepted" });
    expect(oc.noteProposalDecision).not.toHaveBeenCalled();
  });
});

describe("listAgentChats", () => {
  it("hides deleted chats", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listAgentChats();
    expect(query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/);
    expect(query.mock.calls[0][1]).toEqual([TEST_USER_ID]);
  });
});

describe("deleteAgentChat", () => {
  const toolMessage = (proposalId: number) => ({
    id: "m1", role: "assistant", text: "", error: null, createdAt: 1,
    tools: [{ name: "delete_transaction", status: "completed", proposalId, error: null }],
  });

  it("refuses a chat the user doesn't own (or already deleted)", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await deleteAgentChat(5)).toEqual({ ok: false, error: "Chat not found" });
    expect(query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("soft-deletes the chat and rejects its pending proposals", async () => {
    query.mockResolvedValueOnce({ rows: [chatRow] }).mockResolvedValue({ rows: [] });
    oc.getAgentMessages.mockResolvedValue([toolMessage(12)]);

    expect(await deleteAgentChat(5)).toEqual({ ok: true, data: null });

    expect(query.mock.calls[1][0]).toMatch(/UPDATE agent_chats SET deleted_at = now\(\)/);
    expect(query.mock.calls[1][1]).toEqual([5, TEST_USER_ID]);
    expect(query.mock.calls.some(([sql]) => /DELETE FROM/i.test(sql))).toBe(false);
    expect(query.mock.calls[2][0]).toMatch(/UPDATE agent_proposals SET status = 'rejected'/);
    expect(query.mock.calls[2][0]).toMatch(/status = 'pending'/);
    expect(query.mock.calls[2][1]).toEqual([TEST_USER_ID, [12]]);
  });

  it("still deletes when the agent is unreachable", async () => {
    query.mockResolvedValueOnce({ rows: [chatRow] }).mockResolvedValue({ rows: [] });
    oc.getAgentMessages.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await deleteAgentChat(5)).toEqual({ ok: true, data: null });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
