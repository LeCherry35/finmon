import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, getProposals, oc } = vi.hoisted(() => ({
  query: vi.fn(),
  getProposals: vi.fn(),
  oc: {
    getAgentMessages: vi.fn(),
    isSessionBusy: vi.fn(),
  },
}));

vi.mock("@/db", () => ({ pool: { query } }));
vi.mock("@/lib/agent-proposals", () => ({ getProposals }));
vi.mock("@/lib/opencode", () => ({
  ...oc,
  AgentUnavailableError: class AgentUnavailableError extends Error {},
}));

import { chatState, rejectPendingProposals } from "@/lib/agent-chats";

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  getProposals.mockReset().mockResolvedValue([]);
  oc.getAgentMessages.mockReset().mockResolvedValue([]);
  oc.isSessionBusy.mockReset().mockResolvedValue(false);
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
