import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-token", () => ({ signAgentToken: vi.fn(), verifyAgentToken: vi.fn() }));

import { buildOpencodeConfig } from "@/lib/opencode-config";
import { lockdownProblems } from "@/lib/opencode";

describe("buildOpencodeConfig", () => {
  const cfg = buildOpencodeConfig("tok", { mcpUrl: "http://app:3000/api/agent/mcp", model: "openai/gpt-4.1-mini" });

  it("denies everything except finmon MCP tools, globally and for the agent", () => {
    expect(Object.entries(cfg.permission)).toEqual([["*", "deny"], ["finmon_*", "allow"]]);
    expect(Object.entries(cfg.agent.finmon.permission)).toEqual([["*", "deny"], ["finmon_*", "allow"]]);
    expect(cfg.tools).toEqual({ "*": false, "finmon_*": true });
  });

  it("disables the stock agents and makes finmon the default", () => {
    expect(cfg.default_agent).toBe("finmon");
    for (const a of ["build", "plan", "general", "explore"] as const) {
      expect(cfg.agent[a]).toEqual({ disable: true });
    }
  });

  it("configures only the finmon MCP server, with the user's bearer token", () => {
    expect(Object.keys(cfg.mcp)).toEqual(["finmon"]);
    expect(cfg.mcp.finmon.headers).toEqual({ Authorization: "Bearer tok" });
    expect(cfg.plugin).toEqual([]);
  });

  it("adds no custom provider for built-in providers", () => {
    expect(cfg).not.toHaveProperty("provider");
    const withUrl = buildOpencodeConfig("tok", {
      mcpUrl: "x",
      model: "openai/gpt-4.1-mini",
      litellmBaseUrl: "https://llm.example.com/v1",
    });
    expect(withUrl).not.toHaveProperty("provider");
  });

  it("adds a LiteLLM provider for litellm/<model>, keeping the key as an env placeholder", () => {
    const c = buildOpencodeConfig("tok", {
      mcpUrl: "x",
      model: "litellm/qwen/qwen3-32b",
      litellmBaseUrl: "https://llm.example.com/v1",
    });
    expect(c.model).toBe("litellm/qwen/qwen3-32b");
    expect(c.provider).toEqual({
      litellm: {
        npm: "@ai-sdk/openai-compatible",
        name: "LiteLLM",
        options: { baseURL: "https://llm.example.com/v1", apiKey: "{env:LITELLM_API_KEY}" },
        models: { "qwen/qwen3-32b": { name: "qwen/qwen3-32b" } },
      },
    });
  });

  it("adds no LiteLLM provider without a base URL", () => {
    expect(buildOpencodeConfig("tok", { mcpUrl: "x", model: "litellm/m" })).not.toHaveProperty("provider");
  });
});

describe("lockdownProblems", () => {
  const rules = (...extra: { permission: string; pattern: string; action: string }[]) => [
    { permission: "*", pattern: "*", action: "allow" },
    { permission: "read", pattern: "*", action: "allow" },
    ...extra,
  ];
  const deny = { permission: "*", pattern: "*", action: "deny" };
  const allowFinmon = { permission: "finmon_*", pattern: "*", action: "allow" };

  it("passes when the ruleset ends in deny-all + allow finmon", () => {
    expect(lockdownProblems([{ name: "finmon", permission: rules(deny, allowFinmon) }], { finmon: {} })).toEqual([]);
  });

  it("tolerates opencode's own tool-output directory allowance after the deny", () => {
    const toolOutput = (pattern: string) => ({ permission: "external_directory", pattern, action: "allow" });
    for (const pattern of ["C:\\Users\\me\\.local\\share\\opencode\\tool-output\\*", "/home/agent/.local/share/opencode/tool-output/*"]) {
      expect(
        lockdownProblems([{ name: "finmon", permission: rules(deny, allowFinmon, toolOutput(pattern)) }], { finmon: {} }),
      ).toEqual([]);
    }
    expect(
      lockdownProblems([{ name: "finmon", permission: rules(deny, allowFinmon, toolOutput("/etc/*")) }], { finmon: {} }).join(),
    ).toMatch(/external_directory=allow/);
  });

  it("flags a rule re-allowing a built-in after the deny", () => {
    const problems = lockdownProblems(
      [{ name: "finmon", permission: rules(deny, allowFinmon, { permission: "bash", pattern: "*", action: "allow" }) }],
      { finmon: {} },
    );
    expect(problems.join()).toMatch(/bash=allow/);
  });

  it("flags a missing deny-all, a stock agent, a missing finmon agent and extra MCP servers", () => {
    expect(lockdownProblems([{ name: "finmon", permission: rules() }], { finmon: {} }).join()).toMatch(/no deny-all/);
    expect(
      lockdownProblems([{ name: "finmon", permission: rules(deny, allowFinmon) }, { name: "build" }], { finmon: {} }).join(),
    ).toMatch(/build/);
    expect(lockdownProblems([], { finmon: {} }).join()).toMatch(/finmon agent missing/);
    expect(
      lockdownProblems([{ name: "finmon", permission: rules(deny, allowFinmon) }], { finmon: {}, github: {} }).join(),
    ).toMatch(/extra MCP/);
  });
});
