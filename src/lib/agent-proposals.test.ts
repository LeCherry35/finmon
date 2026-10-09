import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { query, release, getAgentTool, ToolError, busySessionIds } = vi.hoisted(() => ({
  busySessionIds: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
  getAgentTool: vi.fn(),
  ToolError: class AgentToolError extends Error {},
}));

vi.mock("@/db", () => ({ pool: { query, connect: vi.fn(async () => ({ query, release })) } }));
vi.mock("@/lib/opencode", () => ({ busySessionIds }));
vi.mock("@/lib/agent-tools", () => ({
  AgentToolError: ToolError,
  getAgentTool,
  parseToolInput: (tool: { input: z.ZodType }, raw: unknown) => {
    const r = tool.input.safeParse(raw ?? {});
    if (!r.success) throw new ToolError("bad input");
    return r.data;
  },
}));

import {
  MAX_PENDING_PROPOSALS,
  SUGGESTION_HISTORY_LIMIT,
  callAgentTool,
  countPendingProposals,
  decideProposal,
  listProposals,
} from "@/lib/agent-proposals";

const readTool = {
  name: "list_categories",
  input: z.object({}),
  requiresApproval: false,
  run: vi.fn(),
};
const writeTool = {
  name: "delete_transactions",
  input: z.object({ id: z.number() }),
  requiresApproval: true,
  describe: vi.fn(),
  run: vi.fn(),
};

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  busySessionIds.mockReset().mockResolvedValue(new Set());
  readTool.run.mockReset();
  writeTool.run.mockReset();
  writeTool.describe.mockReset();
  getAgentTool
    .mockReset()
    .mockImplementation(
      (n: string) =>
        ({ list_categories: readTool, delete_transactions: writeTool })[n as "list_categories"],
    );
});

describe("callAgentTool", () => {
  it("runs a read tool immediately as the given user", async () => {
    readTool.run.mockResolvedValue([{ id: 1 }]);
    expect(await callAgentTool("user-1", "list_categories", {})).toEqual({
      ok: true,
      data: [{ id: 1 }],
    });
    expect(readTool.run).toHaveBeenCalledWith("user-1", {});
    expect(query).not.toHaveBeenCalled();
  });

  /** Route the proposal-storing queries: the pending COUNT returns `count`,
   *  the INSERT returns id 12, the running-chat lookup returns two chats. */
  function db(count = 0) {
    query.mockImplementation(async (sql: string) => {
      if (/COUNT/.test(sql)) return { rows: [{ count }] };
      if (/FROM agent_chats/.test(sql))
        return { rows: [{ id: 5, opencode_session_id: "ses_1" }, { id: 6, opencode_session_id: "ses_2" }] };
      if (/INSERT/.test(sql)) return { rows: [{ id: 12 }] };
      return { rows: [] };
    });
  }
  const statements = () => query.mock.calls.map(([sql]) => String(sql).trim());
  const insertCall = () => query.mock.calls.find(([sql]) => /INSERT/.test(sql))!;

  it("stores an approval tool call as a pending proposal without running it", async () => {
    writeTool.describe.mockResolvedValue("Delete transaction #9");
    db();

    const result = await callAgentTool("user-1", "delete_transactions", { id: 9 });

    expect(writeTool.run).not.toHaveBeenCalled();
    expect(insertCall()[1]).toEqual([
      "user-1",
      "delete_transactions",
      '{"id":9}',
      "Delete transaction #9",
      null, // no chat has a running turn
    ]);
    expect(result).toMatchObject({
      ok: true,
      data: { status: "pending_user_approval", proposal_id: 12 },
    });
  });

  it("counts and inserts under the user's advisory lock, in one transaction", async () => {
    writeTool.describe.mockResolvedValue("s");
    db();
    await callAgentTool("user-1", "delete_transactions", { id: 9 });
    const order = statements().map((s) => s.split(/\s/)[0]);
    expect(order).toEqual(["BEGIN", "SELECT", "SELECT", "INSERT", "COMMIT"]);
    expect(query.mock.calls[1]).toEqual(["SELECT pg_advisory_xact_lock(hashtext($1))", ["user-1"]]);
    expect(release).toHaveBeenCalled();
  });

  it.each([
    [["ses_1"], 5],
    [["ses_1", "ses_2"], null], // two running chats: ambiguous
    [["ses_other"], null],
  ])("links the proposal to the user's one running chat (%#)", async (busy, chatId) => {
    writeTool.describe.mockResolvedValue("s");
    busySessionIds.mockResolvedValue(new Set(busy));
    db();
    await callAgentTool("user-1", "delete_transactions", { id: 9 });
    expect(insertCall()[1].at(-1)).toBe(chatId);
  });

  it("still stores the proposal when the session status can't be read", async () => {
    writeTool.describe.mockResolvedValue("s");
    busySessionIds.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    db();
    expect(await callAgentTool("user-1", "delete_transactions", { id: 9 })).toMatchObject({ ok: true });
    expect(insertCall()[1].at(-1)).toBeNull();
  });

  it("refuses new proposals once the pending cap is reached", async () => {
    writeTool.describe.mockResolvedValue("s");
    db(MAX_PENDING_PROPOSALS);
    const result = await callAgentTool("user-1", "delete_transactions", { id: 9 });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/already 20 changes waiting/) });
    expect(statements()).toContain("ROLLBACK");
    expect(insertCall()).toBeUndefined();
    expect(release).toHaveBeenCalled();
  });

  it("reports describe failures, bad input and unknown tools as errors, storing nothing", async () => {
    query.mockResolvedValue({ rows: [{ count: 0 }] });
    writeTool.describe.mockRejectedValue(new ToolError("Transaction 9 not found"));

    expect(await callAgentTool("user-1", "delete_transactions", { id: 9 })).toEqual({
      ok: false,
      error: "Transaction 9 not found",
    });
    expect(await callAgentTool("user-1", "delete_transactions", { id: "x" })).toEqual({
      ok: false,
      error: "bad input",
    });
    expect(await callAgentTool("user-1", "drop_database", {})).toEqual({
      ok: false,
      error: "Unknown tool: drop_database",
    });
    expect(query.mock.calls.some(([sql]) => /INSERT/.test(sql))).toBe(false);
  });
});

describe("decideProposal", () => {
  const pending = {
    id: 12,
    tool: "delete_transactions",
    args: { id: 9 },
    summary: "s",
    status: "pending",
  };

  /** Route the pooled client's queries: the locked SELECT returns `rows`,
   *  the UPDATE echoes back the status/error it was given. */
  function db(rows: unknown[]) {
    query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/FOR UPDATE/.test(sql)) return { rows };
      if (/UPDATE agent_proposals/.test(sql))
        return { rows: [{ ...pending, status: params?.[0], error: params?.[1] }] };
      return { rows: [] };
    });
  }
  const statements = () => query.mock.calls.map(([sql]) => String(sql).trim());

  it("locks the user's own row and applies it on accept", async () => {
    db([pending]);
    const result = await decideProposal("user-1", 12, "accept");

    expect(writeTool.run).toHaveBeenCalledWith("user-1", { id: 9 });
    expect(result).toMatchObject({ ok: true, proposal: { status: "accepted" } });
    const select = query.mock.calls.find(([sql]) => /FOR UPDATE/.test(sql))!;
    expect(select[1]).toEqual([12, "user-1"]);
    expect(statements().at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalled();
  });

  it("marks the proposal failed when applying throws a tool error", async () => {
    db([pending]);
    writeTool.run.mockRejectedValue(new ToolError("Transaction not found"));
    expect(await decideProposal("user-1", 12, "accept")).toMatchObject({
      ok: true,
      proposal: { status: "failed", error: "Transaction not found" },
    });
  });

  it("rejects without running the tool", async () => {
    db([pending]);
    expect(await decideProposal("user-1", 12, "reject")).toMatchObject({
      ok: true,
      proposal: { status: "rejected" },
    });
    expect(writeTool.run).not.toHaveBeenCalled();
  });

  it.each([
    [[], "Proposal not found"],
    [[{ ...pending, status: "accepted" }], "Already accepted"],
  ])("refuses a missing/foreign or already-decided proposal (%#)", async (rows, error) => {
    db(rows);
    expect(await decideProposal("user-1", 12, "accept")).toEqual({ ok: false, error });
    expect(writeTool.run).not.toHaveBeenCalled();
    expect(statements()).toContain("ROLLBACK");
  });
});

describe("countPendingProposals / listProposals", () => {
  it("counts the user's pending proposals", async () => {
    query.mockResolvedValueOnce({ rows: [{ count: 3 }] });
    expect(await countPendingProposals("user-1")).toBe(3);
    expect(query.mock.calls[0][1]).toEqual(["user-1"]);
  });

  it("lists all pending and the latest decided ones, with chat titles", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 2 }] }).mockResolvedValueOnce({ rows: [{ id: 1 }] });
    expect(await listProposals("user-1")).toEqual({ pending: [{ id: 2 }], history: [{ id: 1 }] });
    const [pending, history] = query.mock.calls;
    expect(pending[0]).toMatch(/status = 'pending'/);
    expect(pending[0]).toMatch(/LEFT JOIN agent_chats/);
    expect(pending[1]).toEqual(["user-1"]);
    expect(history[0]).toMatch(/status <> 'pending'/);
    expect(history[1]).toEqual(["user-1", SUGGESTION_HISTORY_LIMIT]);
  });
});
