import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-token", () => ({
  signAgentToken: vi.fn(() => ({ token: "tok" })),
  verifyAgentToken: vi.fn(() => null),
}));

import { attachmentMarker, deleteLastTurn, isSessionBusy, sendAgentPrompt } from "@/lib/opencode";

type Call = { method: string; path: string; body: unknown };
let calls: Call[];

/** Fake opencode server: `routes` maps "METHOD /path" to a JSON response. */
function serve(routes: Record<string, unknown>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: RequestInit) => {
      const method = init.method ?? "GET";
      const key = `${method} ${url.pathname}`;
      calls.push({ method, path: url.pathname, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (key in routes) {
        const value = routes[key];
        return value === 204 ? new Response(null, { status: 204 }) : Response.json(value);
      }
      if (method === "DELETE") return Response.json(true);
      return new Response("not found", { status: 404 });
    }),
  );
}

const text = (id: string, role: "user" | "assistant", body: string, extra: object[] = []) => ({
  info: { id, role, time: { created: 1 } },
  parts: [{ id: `${id}p`, type: "text", text: body }, ...extra],
});
const proposalTool = (proposalId: number) => ({
  id: "t",
  type: "tool",
  tool: "finmon_create_transaction",
  state: { status: "completed", output: JSON.stringify({ status: "pending_user_approval", proposal_id: proposalId }) },
});

beforeEach(() => {
  vi.stubEnv("OPENCODE_URL", "http://opencode.test");
  vi.stubEnv("AGENT_MCP_URL", "http://app.test/api/agent/mcp");
  vi.stubEnv("AGENT_WORKSPACE_ROOT", mkdtempSync(path.join(tmpdir(), "finmon-oc-")));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("isSessionBusy", () => {
  it.each([
    [{ ses_1: { type: "busy" } }, true],
    [{ ses_1: { type: "retry" } }, true],
    [{ ses_1: { type: "idle" } }, false],
    [{ ses_2: { type: "busy" } }, false], // idle sessions aren't listed
  ])("reads opencode's session status (%#)", async (status, busy) => {
    serve({ "GET /session/status": status });
    expect(await isSessionBusy("user-1", "ses_1")).toBe(busy);
  });
});

describe("deleteLastTurn", () => {
  it("deletes from the user's last message on and reports what it undid", async () => {
    serve({
      "GET /session/ses_1/message": [
        text("m1", "user", "hi"),
        text("m2", "assistant", "hello"),
        text("m3", "user", "[finmon] The user ACCEPTED proposal 3"), // a note, not the user's
        text("m4", "user", `add it\n\n${attachmentMarker(42)}`),
        text("m5", "assistant", "scanning", [proposalTool(12)]),
      ],
    });

    expect(await deleteLastTurn("user-1", "ses_1")).toEqual({
      proposalIds: [12],
      text: "add it",
      attachmentId: 42,
      remaining: 3,
    });
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([
      "/session/ses_1/message/m4",
      "/session/ses_1/message/m5",
    ]);
  });

  it("does nothing when the user has no message", async () => {
    serve({ "GET /session/ses_1/message": [] });
    expect(await deleteLastTurn("user-1", "ses_1")).toEqual({
      proposalIds: [],
      text: "",
      attachmentId: null,
      remaining: 0,
    });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});

describe("sendAgentPrompt", () => {
  it("starts the turn with prompt_async and returns without waiting for it", async () => {
    serve({
      "GET /agent": [
        {
          name: "finmon",
          permission: [
            { permission: "*", pattern: "*", action: "deny" },
            { permission: "finmon_*", pattern: "*", action: "allow" },
          ],
        },
      ],
      "GET /mcp": { finmon: {} },
      "POST /session/ses_1/prompt_async": 204,
    });
    await sendAgentPrompt("user-1", "ses_1", "hi", "receipt");
    const prompt = calls.find((c) => c.path.endsWith("/prompt_async"));
    expect(prompt?.body).toMatchObject({
      agent: "finmon",
      parts: [{ type: "text", text: "hi" }],
      tools: { "*": false, finmon_scan_receipt: true, finmon_create_transaction: true },
    });
    expect(calls.some((c) => c.path === "/session/ses_1/message")).toBe(false);
  });
});
