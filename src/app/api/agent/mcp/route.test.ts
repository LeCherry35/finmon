import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAgentToken, callAgentTool } = vi.hoisted(() => ({
  verifyAgentToken: vi.fn(),
  callAgentTool: vi.fn(),
}));

vi.mock("@/lib/agent-token", () => ({ verifyAgentToken }));
vi.mock("@/lib/agent-proposals", () => ({ callAgentTool }));
vi.mock("@/db", () => ({ pool: { query: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { GET, POST } from "@/app/api/agent/mcp/route";

const rpc = (body: unknown, token = "good") =>
  POST(
    new Request("http://app/api/agent/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  verifyAgentToken.mockReset().mockImplementation((t: string) => (t === "good" ? "user-1" : null));
  callAgentTool.mockReset();
});

describe("/api/agent/mcp", () => {
  it("401s without a valid bearer token and never runs a tool", async () => {
    const res = await rpc(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_categories" } },
      "bad",
    );
    expect(res.status).toBe(401);
    expect(callAgentTool).not.toHaveBeenCalled();
  });

  it("answers initialize with the tools capability", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    });
    const body = await res.json();
    expect(body.result.protocolVersion).toBe("2025-03-26");
    expect(body.result.capabilities).toEqual({ tools: { listChanged: false } });
  });

  it("202s a notification", async () => {
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
  });

  it("lists the registry tools with JSON schemas, flagging approval tools", async () => {
    const body = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    const tools: { name: string; description: string; inputSchema: Record<string, unknown> }[] =
      body.result.tools;
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["search_transactions", "create_transaction", "set_plan"]),
    );
    const create = tools.find((t) => t.name === "create_transaction")!;
    expect(create.description).toMatch(/Requires the user's approval/);
    expect(create.inputSchema.type).toBe("object");
    expect(create.inputSchema.$schema).toBeUndefined();
    const search = tools.find((t) => t.name === "search_transactions")!;
    expect(search.description).not.toMatch(/approval/);
  });

  it("runs tools/call as the token's user, never a user from the arguments", async () => {
    callAgentTool.mockResolvedValue({ ok: true, data: [{ id: 1 }] });
    const body = await (
      await rpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_categories", arguments: { user_id: "user-2" } },
      })
    ).json();
    expect(callAgentTool).toHaveBeenCalledWith("user-1", "list_categories", { user_id: "user-2" });
    expect(body.result.content[0].text).toBe('[{"id":1}]');
  });

  it("returns tool failures as isError results", async () => {
    callAgentTool.mockResolvedValue({ ok: false, error: "Transaction 9 not found" });
    const body = await (
      await rpc({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "get_transaction", arguments: { id: 9 } },
      })
    ).json();
    expect(body.result).toEqual({
      content: [{ type: "text", text: "Transaction 9 not found" }],
      isError: true,
    });
  });

  it("errors on unknown methods and rejects GET", async () => {
    const body = await (await rpc({ jsonrpc: "2.0", id: 5, method: "resources/list" })).json();
    expect(body.error.code).toBe(-32601);
    expect(GET().status).toBe(405);
  });
});
