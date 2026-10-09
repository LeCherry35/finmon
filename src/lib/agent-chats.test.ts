import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, getProposals, decideProposal, oc } = vi.hoisted(() => ({
  query: vi.fn(),
  getProposals: vi.fn(),
  decideProposal: vi.fn(),
  oc: {
    busySessionIds: vi.fn(),
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

import {
  NO_REPLY,
  STILL_RUNNING,
  chatState,
  decideAllPending,
  decideWithNote,
  rejectPendingProposals,
  withDeadTurn,
} from "@/lib/agent-chats";

beforeEach(() => {
  vi.stubEnv("AGENT_MODEL", "");
  vi.stubEnv("AGENT_OPENCODE_MODELS", "opencode/big-pickle");
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  getProposals.mockReset().mockResolvedValue([]);
  oc.getAgentMessages.mockReset().mockResolvedValue([]);
  oc.isSessionBusy.mockReset().mockResolvedValue(false);
  oc.busySessionIds.mockReset().mockResolvedValue(new Set());
  oc.noteProposalDecision.mockReset().mockResolvedValue(undefined);
  decideProposal.mockReset();
});

describe("chatState", () => {
  it.each([true, false])("reports whether the session is running (%s)", async (busy) => {
    oc.isSessionBusy.mockResolvedValue(busy);
    expect(await chatState("user-1", 5, "ses_1")).toEqual({
      chatId: 5,
      messages: [],
      proposals: {},
      running: busy,
      model: "openai/gpt-4.1-mini",
    });
    expect(oc.isSessionBusy).toHaveBeenCalledWith("user-1", "ses_1");
  });

  it("attaches the user's proposals referenced by tool calls", async () => {
    oc.getAgentMessages.mockResolvedValue([
      { id: "m1", role: "assistant", text: "", error: null, createdAt: 1, attachmentId: null, tools: [{ name: "delete_transactions", status: "completed", proposalId: 12, error: null }] },
    ]);
    getProposals.mockResolvedValue([{ id: 12, status: "pending" }]);
    const state = await chatState("user-1", 5, "ses_1");
    expect(getProposals).toHaveBeenCalledWith("user-1", [12]);
    expect(state.proposals).toEqual({ 12: { id: 12, status: "pending" } });
    // …and links them to this chat if creation couldn't tell.
    expect(query.mock.calls[0][0]).toMatch(/SET chat_id = \$1[\s\S]*chat_id IS NULL/);
    expect(query.mock.calls[0][1]).toEqual([5, "user-1", [12]]);
  });

  it("reports the chat's stored model while it's still offered, else the default", async () => {
    expect((await chatState("user-1", 5, "ses_1", "opencode/big-pickle")).model).toBe("opencode/big-pickle");
    expect((await chatState("user-1", 5, "ses_1", "gone/model")).model).toBe("openai/gpt-4.1-mini");
  });

  it("links nothing when no proposals are referenced", async () => {
    await chatState("user-1", 5, "ses_1");
    expect(query).not.toHaveBeenCalled();
  });
});

describe("withDeadTurn", () => {
  const userMsg = (createdAt: number) => ({
    id: "m1",
    role: "user" as const,
    text: "hi",
    error: null,
    createdAt,
    attachmentId: null,
    tools: [],
  });
  const now = 1_000_000;

  it("leaves a running turn alone", () => {
    const messages = [userMsg(now - 60_000)];
    expect(withDeadTurn(messages, true, now)).toEqual({ messages, running: true });
  });

  it("keeps a just-sent message running while opencode hasn't reported it busy", () => {
    const messages = [userMsg(now - 1_000)];
    expect(withDeadTurn(messages, false, now)).toEqual({ messages, running: true });
  });

  it("reports an unanswered message as a failed turn once the grace period is up", () => {
    const { messages, running } = withDeadTurn([userMsg(now - 60_000)], false, now);
    expect(running).toBe(false);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ id: "m1-no-reply", role: "assistant", text: "", error: NO_REPLY });
  });

  it("says nothing when the agent did reply", () => {
    const messages = [
      userMsg(now - 60_000),
      { id: "m2", role: "assistant" as const, text: "hello", error: null, createdAt: now - 59_000, attachmentId: null, tools: [] },
    ];
    expect(withDeadTurn(messages, false, now)).toEqual({ messages, running: false });
  });

  it("says nothing about an empty chat", () => {
    expect(withDeadTurn([], false, now)).toEqual({ messages: [], running: false });
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
  const proposal = { id: 12, tool: "delete_transactions", status: "accepted", error: null };
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

describe("decideAllPending", () => {
  const pending = [
    { id: 4, session: "ses_1" },
    { id: 5, session: "ses_1" },
    { id: 6, session: null }, // chat unknown or deleted
    { id: 7, session: "ses_2" },
  ];
  const decided = (id: number, status: string, error: string | null = null) => ({
    id,
    tool: "delete_transactions",
    status,
    error,
  });

  it("does nothing when nothing is pending", async () => {
    expect(await decideAllPending("user-1", "accept")).toEqual({ ok: true, data: [] });
    expect(query.mock.calls[0][1]).toEqual(["user-1"]);
    expect(decideProposal).not.toHaveBeenCalled();
  });

  it("refuses while any of the proposals' chats is running", async () => {
    query.mockResolvedValueOnce({ rows: pending });
    oc.busySessionIds.mockResolvedValue(new Set(["ses_2"]));
    expect(await decideAllPending("user-1", "reject")).toEqual({ ok: false, error: STILL_RUNNING });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("rejects all in one UPDATE and notes each chat once", async () => {
    query
      .mockResolvedValueOnce({ rows: pending })
      .mockResolvedValueOnce({ rows: pending.map((p) => decided(p.id, "rejected")) });
    const result = await decideAllPending("user-1", "reject");
    expect(result).toMatchObject({ ok: true, data: [{ id: 4 }, { id: 5 }, { id: 6 }, { id: 7 }] });
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/SET status = 'rejected'[\s\S]*status = 'pending'/);
    expect(params).toEqual(["user-1", [4, 5, 6, 7]]);
    expect(decideProposal).not.toHaveBeenCalled();
    expect(oc.noteProposalDecision.mock.calls).toEqual([
      ["user-1", "ses_1", "The user REJECTED proposals 4, 5; nothing was changed."],
      ["user-1", "ses_2", "The user REJECTED proposal 7 (delete_transactions); nothing was changed."],
    ]);
  });

  it("accepts oldest first, carries on past a failure, and notes the outcome", async () => {
    query.mockResolvedValueOnce({ rows: pending });
    decideProposal.mockImplementation(async (_u: string, id: number) =>
      id === 6
        ? { ok: false, error: "Already rejected" }
        : { ok: true, proposal: id === 5 ? decided(5, "failed", "Already deleted") : decided(id, "accepted") },
    );
    const result = await decideAllPending("user-1", "accept");
    expect(decideProposal.mock.calls.map((c) => c[1])).toEqual([4, 5, 6, 7]);
    expect(result).toMatchObject({ ok: true, data: [{ id: 4 }, { id: 5 }, { id: 7 }] });
    expect(oc.noteProposalDecision.mock.calls[0]).toEqual([
      "user-1",
      "ses_1",
      "The user ACCEPTED proposal 4 (delete_transactions); it has been applied. " +
        "The user accepted proposal 5 (delete_transactions) but applying it FAILED: Already deleted. Nothing was changed.",
    ]);
  });
});
