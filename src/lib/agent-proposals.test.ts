import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { query, release, getAgentTool, ToolError } = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  getAgentTool: vi.fn(),
  ToolError: class AgentToolError extends Error {},
}));

vi.mock("@/db", () => ({ pool: { query, connect: vi.fn(async () => ({ query, release })) } }));
vi.mock("@/lib/agent-tools", () => ({
  AgentToolError: ToolError,
  getAgentTool,
  parseToolInput: (tool: { input: z.ZodType }, raw: unknown) => {
    const r = tool.input.safeParse(raw ?? {});
    if (!r.success) throw new ToolError("bad input");
    return r.data;
  },
}));

import { MAX_PENDING_PROPOSALS, callAgentTool, decideProposal } from "@/lib/agent-proposals";

const readTool = {
  name: "list_categories",
  input: z.object({}),
  requiresApproval: false,
  run: vi.fn(),
};
const writeTool = {
  name: "delete_transaction",
  input: z.object({ id: z.number() }),
  requiresApproval: true,
  describe: vi.fn(),
  run: vi.fn(),
};

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  readTool.run.mockReset();
  writeTool.run.mockReset();
  writeTool.describe.mockReset();
  getAgentTool
    .mockReset()
    .mockImplementation(
      (n: string) =>
        ({ list_categories: readTool, delete_transaction: writeTool })[n as "list_categories"],
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

  it("stores an approval tool call as a pending proposal without running it", async () => {
    writeTool.describe.mockResolvedValue("Delete transaction #9");
    query
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 12 }] });

    const result = await callAgentTool("user-1", "delete_transaction", { id: 9 });

    expect(writeTool.run).not.toHaveBeenCalled();
    expect(query.mock.calls[1][0]).toMatch(/INSERT INTO agent_proposals/);
    expect(query.mock.calls[1][1]).toEqual([
      "user-1",
      "delete_transaction",
      '{"id":9}',
      "Delete transaction #9",
    ]);
    expect(result).toMatchObject({
      ok: true,
      data: { status: "pending_user_approval", proposal_id: 12 },
    });
  });

  it("refuses new proposals once the pending cap is reached", async () => {
    query.mockResolvedValueOnce({ rows: [{ count: MAX_PENDING_PROPOSALS }] });
    const result = await callAgentTool("user-1", "delete_transaction", { id: 9 });
    expect(result.ok).toBe(false);
    expect(writeTool.describe).not.toHaveBeenCalled();
  });

  it("reports describe failures, bad input and unknown tools as errors, storing nothing", async () => {
    query.mockResolvedValue({ rows: [{ count: 0 }] });
    writeTool.describe.mockRejectedValue(new ToolError("Transaction 9 not found"));

    expect(await callAgentTool("user-1", "delete_transaction", { id: 9 })).toEqual({
      ok: false,
      error: "Transaction 9 not found",
    });
    expect(await callAgentTool("user-1", "delete_transaction", { id: "x" })).toEqual({
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
    tool: "delete_transaction",
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
