import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_USER_ID } from "../../test/helpers";

const { query, decideProposal, getProposals, oc } = vi.hoisted(() => ({
  query: vi.fn(),
  decideProposal: vi.fn(),
  getProposals: vi.fn(),
  oc: {
    createAgentSession: vi.fn(),
    getAgentMessages: vi.fn(),
    noteProposalDecision: vi.fn(),
    sendAgentPrompt: vi.fn(),
  },
}));

vi.mock("@/db", () => ({ pool: { query } }));
vi.mock("@/lib/dal", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/agent-proposals", () => ({ decideProposal, getProposals }));
vi.mock("@/lib/opencode", () => ({
  ...oc,
  AgentUnavailableError: class AgentUnavailableError extends Error {},
}));

import { acceptProposal, loadAgentChat, rejectProposal, sendAgentMessage } from "@/actions/agent";

const chatRow = { id: 5, opencode_session_id: "ses_1" };

beforeEach(() => {
  query.mockReset();
  decideProposal.mockReset();
  getProposals.mockReset().mockResolvedValue([]);
  for (const fn of Object.values(oc)) fn.mockReset();
  oc.getAgentMessages.mockResolvedValue([]);
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
    expect(result).toEqual({ ok: true, data: { chatId: 7, messages: [], proposals: {} } });
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

describe("loadAgentChat", () => {
  it("refuses another user's chat", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await loadAgentChat(5)).toEqual({ ok: false, error: "Chat not found" });
    expect(oc.getAgentMessages).not.toHaveBeenCalled();
  });
});

describe("accept/reject", () => {
  it("refuses when the chat isn't the user's, without deciding", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await acceptProposal(5, 12)).toEqual({ ok: false, error: "Chat not found" });
    expect(decideProposal).not.toHaveBeenCalled();
  });

  it("decides as the signed-in user and tells the agent the outcome", async () => {
    query.mockResolvedValue({ rows: [chatRow] });
    decideProposal.mockResolvedValue({ ok: true, proposal: { id: 12, tool: "delete_transaction", status: "rejected" } });
    oc.noteProposalDecision.mockResolvedValue(undefined);

    const result = await rejectProposal(5, 12);

    expect(decideProposal).toHaveBeenCalledWith(TEST_USER_ID, 12, "reject");
    expect(oc.noteProposalDecision).toHaveBeenCalledWith(TEST_USER_ID, "ses_1", expect.stringMatching(/REJECTED proposal 12/));
    expect(result.ok).toBe(true);
  });

  it("passes through a decision error", async () => {
    query.mockResolvedValue({ rows: [chatRow] });
    decideProposal.mockResolvedValue({ ok: false, error: "Already accepted" });
    expect(await acceptProposal(5, 12)).toEqual({ ok: false, error: "Already accepted" });
    expect(oc.noteProposalDecision).not.toHaveBeenCalled();
  });
});
