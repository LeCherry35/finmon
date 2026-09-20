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

/** The routes every prompt hits before the turn itself: lockdown + model check. */
const preflight = {
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
  "GET /config/providers": {
    providers: [
      { id: "opencode", models: { "big-pickle": {} } },
      { id: "litellm", models: { "qwen/qwen3-32b": {} } },
    ],
  },
};

describe("sendAgentPrompt", () => {
  it("starts the turn with prompt_async and returns without waiting for it", async () => {
    serve({ ...preflight, "POST /session/ses_1/prompt_async": 204 });
    vi.stubEnv("AGENT_MODEL", "opencode/big-pickle");
    await sendAgentPrompt("user-1", "ses_1", "hi", "receipt", "openai/gpt-4.1-mini");
    const prompt = calls.find((c) => c.path.endsWith("/prompt_async"));
    expect(prompt?.body).toMatchObject({
      agent: "finmon",
      // Receipt turns always run on the default model.
      model: { providerID: "opencode", modelID: "big-pickle" },
      parts: [{ type: "text", text: "hi" }],
      tools: { "*": false, finmon_scan_receipt: true, finmon_create_transaction: true },
    });
    expect(calls.some((c) => c.path === "/session/ses_1/message")).toBe(false);
  });

  it("runs a chat turn on the model it's given, splitting provider and model ids", async () => {
    serve({ ...preflight, "POST /session/ses_1/prompt_async": 204 });
    await sendAgentPrompt("user-1", "ses_1", "hi", "chat", "litellm/qwen/qwen3-32b");
    const prompt = calls.find((c) => c.path.endsWith("/prompt_async"));
    expect(prompt?.body).toMatchObject({ model: { providerID: "litellm", modelID: "qwen/qwen3-32b" } });
  });

  // A provider whose API key is missing from opencode's environment isn't
  // registered at all; prompt_async would accept the turn and it would then die
  // without ever writing an assistant message.
  it("refuses to start a turn on a model opencode doesn't serve", async () => {
    serve({ ...preflight, "POST /session/ses_1/prompt_async": 204 });
    await expect(sendAgentPrompt("user-1", "ses_1", "hi", "chat", "openai/gpt-4.1-mini")).rejects.toThrow(
      /openai\/gpt-4\.1-mini/,
    );
    expect(calls.some((c) => c.path.endsWith("/prompt_async"))).toBe(false);
  });

  it("refuses a model whose provider is registered without it", async () => {
    serve({ ...preflight, "POST /session/ses_1/prompt_async": 204 });
    await expect(sendAgentPrompt("user-1", "ses_1", "hi", "chat", "litellm/other-model")).rejects.toThrow(
      /litellm\/other-model/,
    );
    expect(calls.some((c) => c.path.endsWith("/prompt_async"))).toBe(false);
  });

  it("checks a model once and reuses the result", async () => {
    serve({ ...preflight, "POST /session/ses_1/prompt_async": 204 });
    await sendAgentPrompt("user-1", "ses_1", "hi", "chat", "litellm/qwen/qwen3-32b");
    await sendAgentPrompt("user-1", "ses_1", "again", "chat", "litellm/qwen/qwen3-32b");
    expect(calls.filter((c) => c.path === "/config/providers")).toHaveLength(1);
  });
});
