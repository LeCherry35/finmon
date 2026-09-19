import { describe, expect, it } from "vitest";
import { agentModels, effectiveModel, isAllowedModel } from "@/lib/agent-models";

const env = {
  AGENT_MODEL: "opencode/big-pickle",
  AGENT_OPENCODE_MODELS: " openai/gpt-4.1-mini , anthropic/claude-sonnet-5,,opencode/big-pickle ",
  AGENT_LITELLM_MODELS: "qwen/qwen3-32b, llama-3.3-70b",
  LITELLM_BASE_URL: "https://llm.example.com/v1",
};

describe("agentModels", () => {
  it("lists the default first, then opencode models, then LiteLLM models, trimmed and deduped", () => {
    const m = agentModels(env);
    expect(m.default).toBe("opencode/big-pickle");
    expect(m.models).toEqual([
      { id: "opencode/big-pickle", label: "opencode/big-pickle" },
      { id: "openai/gpt-4.1-mini", label: "openai/gpt-4.1-mini" },
      { id: "anthropic/claude-sonnet-5", label: "anthropic/claude-sonnet-5" },
      { id: "litellm/qwen/qwen3-32b", label: "qwen/qwen3-32b (LiteLLM)" },
      { id: "litellm/llama-3.3-70b", label: "llama-3.3-70b (LiteLLM)" },
    ]);
    expect(m.litellmIds).toEqual(["qwen/qwen3-32b", "llama-3.3-70b"]);
  });

  it("falls back to the built-in default and offers only it when nothing else is set", () => {
    expect(agentModels({})).toEqual({
      default: "openai/gpt-4.1-mini",
      models: [{ id: "openai/gpt-4.1-mini", label: "openai/gpt-4.1-mini" }],
      litellmIds: [],
    });
  });

  it("ignores LiteLLM models without a base URL", () => {
    const m = agentModels({ ...env, LITELLM_BASE_URL: "" });
    expect(m.models.map((x) => x.id)).not.toContain("litellm/qwen/qwen3-32b");
    expect(m.litellmIds).toEqual([]);
  });

  it("accepts LiteLLM names written with the litellm/ prefix", () => {
    const m = agentModels({ AGENT_LITELLM_MODELS: "litellm/Qwen3.8-27B-NVFP4", LITELLM_BASE_URL: "https://x/v1" });
    expect(m.models.map((x) => x.id)).toContain("litellm/Qwen3.8-27B-NVFP4");
    expect(m.litellmIds).toEqual(["Qwen3.8-27B-NVFP4"]);
  });

  it("keeps a LiteLLM default in the LiteLLM ids", () => {
    const m = agentModels({ AGENT_MODEL: "litellm/qwen/qwen3-32b", LITELLM_BASE_URL: "https://x/v1" });
    expect(m.litellmIds).toEqual(["qwen/qwen3-32b"]);
  });
});

describe("isAllowedModel / effectiveModel", () => {
  it("allows only configured ids", () => {
    expect(isAllowedModel("litellm/llama-3.3-70b", env)).toBe(true);
    expect(isAllowedModel("llama-3.3-70b", env)).toBe(false);
    expect(isAllowedModel("openai/gpt-5", env)).toBe(false);
  });

  it("uses a stored model while it's offered, else the default", () => {
    expect(effectiveModel("anthropic/claude-sonnet-5", env)).toBe("anthropic/claude-sonnet-5");
    expect(effectiveModel("gone/model", env)).toBe("opencode/big-pickle");
    expect(effectiveModel(null, env)).toBe("opencode/big-pickle");
  });
});
