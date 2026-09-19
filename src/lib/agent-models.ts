// The models the assistant may run on, as configured in the env. Pure (reads
// only the env it's given) so the page, the actions and the opencode config
// all agree on one list.

import { LITELLM_PROVIDER } from "@/lib/opencode-config";

export const DEFAULT_AGENT_MODEL = "openai/gpt-4.1-mini";

export type AgentModelOption = { id: string; label: string };
export type AgentModels = {
  /** AGENT_MODEL: new chats start on it and receipt turns always use it. */
  default: string;
  /** Everything selectable, default first. */
  models: AgentModelOption[];
  /** LiteLLM model ids (no `litellm/` prefix) to register in the opencode config. */
  litellmIds: string[];
};

type Env = Record<string, string | undefined>;

const list = (raw: string | undefined) =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const litellmPrefix = `${LITELLM_PROVIDER}/`;

/**
 * AGENT_MODEL (default), then AGENT_OPENCODE_MODELS (`provider/model` ids
 * opencode serves itself), then AGENT_LITELLM_MODELS (LiteLLM names, `litellm/`
 * prefix optional — only with LITELLM_BASE_URL). Duplicates dropped.
 */
export function agentModels(env: Env = process.env): AgentModels {
  const def = env.AGENT_MODEL || DEFAULT_AGENT_MODEL;
  const litellm = env.LITELLM_BASE_URL
    ? list(env.AGENT_LITELLM_MODELS).map((id) => (id.startsWith(litellmPrefix) ? id : litellmPrefix + id))
    : [];
  const ids = [...new Set([def, ...list(env.AGENT_OPENCODE_MODELS), ...litellm])];
  return {
    default: def,
    models: ids.map((id) => ({
      id,
      label: id.startsWith(litellmPrefix) ? `${id.slice(litellmPrefix.length)} (LiteLLM)` : id,
    })),
    litellmIds: ids.filter((id) => id.startsWith(litellmPrefix)).map((id) => id.slice(litellmPrefix.length)),
  };
}

export function isAllowedModel(id: string, env: Env = process.env): boolean {
  return agentModels(env).models.some((m) => m.id === id);
}

/** A chat's stored model if it's still offered, else the default. */
export function effectiveModel(stored: string | null | undefined, env: Env = process.env): string {
  return stored && isAllowedModel(stored, env) ? stored : agentModels(env).default;
}
