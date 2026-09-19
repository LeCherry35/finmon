import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, getProposals, decideProposal, oc } = vi.hoisted(() => ({
  query: vi.fn(),
  getProposals: vi.fn(),
  decideProposal: vi.fn(),
  oc: {
    getAgentMessages: vi.fn(),
    isSessionBusy: vi.fn(),
    noteProposalDecision: vi.fn(),
  },
}));

vi.mock("@/db", () => ({ pool: { query } }));
vi.mock("@/lib/agent-proposals", () => ({ decideProposal, getProposals }));
vi.mock("@/lib/opencode", () => ({
  ...oc,
  AgentUnavailableError: class AgentUnavailableError extends Error {},
}));

import { STILL_RUNNING, chatState, decideWithNote, rejectPendingProposals } from "@/lib/agent-chats";

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  getProposals.mockReset().mockResolvedValue([]);
  oc.getAgentMessages.mockReset().mockResolvedValue([]);
  oc.isSessionBusy.mockReset().mockResolvedValue(false);
  oc.noteProposalDecision.mockReset().mockResolvedValue(undefined);
  decideProposal.mockReset();
});

describe("chatState", () => {
  it.each([true, false])("reports whether the session is running (%s)", async (busy) => {
    oc.isSessionBusy.mockResolvedValue(busy);
    expect(await chatState("user-1", 5, "ses_1")).toEqual({ chatId: 5, messages: [], proposals: {}, running: busy });
    expect(oc.isSessionBusy).toHaveBeenCalledWith("user-1", "ses_1");
  });

  it("attaches the user's proposals referenced by tool calls", async () => {
    oc.getAgentMessages.mockResolvedValue([
      { id: "m1", role: "assistant", text: "", error: null, createdAt: 1, attachmentId: null, tools: [{ name: "delete_transaction", status: "completed", proposalId: 12, error: null }] },
    ]);
    getProposals.mockResolvedValue([{ id: 12, status: "pending" }]);
    const state = await chatState("user-1", 5, "ses_1");
    expect(getProposals).toHaveBeenCalledWith("user-1", [12]);
    expect(state.proposals).toEqual({ 12: { id: 12, status: "pending" } });
    // …and links them to this chat if creation couldn't tell.
    expect(query.mock.calls[0][0]).toMatch(/SET chat_id = \$1[\s\S]*chat_id IS NULL/);
    expect(query.mock.calls[0][1]).toEqual([5, "user-1", [12]]);
  });

  it("links nothing when no proposals are referenced", async () => {
    await chatState("user-1", 5, "ses_1");
    expect(query).not.toHaveBeenCalled();
  });
});

describe("rejectPendingProposals", () => {
  it("rejects only the user's still-pending proposals", async () => {
    await rejectPendingProposals("user-1", [3, 4]);
    expect(query.mock.calls[0][0]).toMatch(/status = 'rejected'[\s\S]*status = 'pending'/);
    expect(query.mock.calls[0][1]).toEqual(["user-1", [3, 4]]);
  });

  it("skips the query for no ids", async () => {
    await rejectPendingProposals("user-1", []);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("decideWithNote", () => {
  const proposal = { id: 12, tool: "delete_transaction", status: "accepted", error: null };
  const session = (value: string | null) => query.mockResolvedValueOnce({ rows: [{ session: value }] });

  it("refuses an unknown or foreign proposal", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await decideWithNote("user-1", 12, "accept")).toEqual({ ok: false, error: "Proposal not found" });
    expect(query.mock.calls[0][1]).toEqual([12, "user-1"]);
    expect(decideProposal).not.toHaveBeenCalled();
  });

  it("refuses while the proposal's chat is running", async () => {
    session("ses_1");
    oc.isSessionBusy.mockResolvedValue(true);
    expect(await decideWithNote("user-1", 12, "accept")).toEqual({ ok: false, error: STILL_RUNNING });
    expect(decideProposal).not.toHaveBeenCalled();
  });

  it("decides and notes the outcome in the proposal's chat", async () => {
    session("ses_1");
    decideProposal.mockResolvedValue({ ok: true, proposal });
    expect(await decideWithNote("user-1", 12, "accept")).toEqual({ ok: true, data: proposal });
    expect(decideProposal).toHaveBeenCalledWith("user-1", 12, "accept");
    expect(oc.noteProposalDecision).toHaveBeenCalledWith("user-1", "ses_1", expect.stringMatching(/ACCEPTED proposal 12/));
  });

  it("decides without a note when the chat is unknown or deleted", async () => {
    session(null);
    decideProposal.mockResolvedValue({ ok: true, proposal });
    expect(await decideWithNote("user-1", 12, "accept")).toMatchObject({ ok: true });
    expect(oc.isSessionBusy).not.toHaveBeenCalled();
    expect(oc.noteProposalDecision).not.toHaveBeenCalled();
  });

  it("still succeeds when the note can't be posted", async () => {
    session("ses_1");
    decideProposal.mockResolvedValue({ ok: true, proposal });
    oc.noteProposalDecision.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await decideWithNote("user-1", 12, "accept")).toMatchObject({ ok: true });
  });
});
