// The opencode.json finmon writes into each user's instance directory. Kept
// free of imports so it can be unit-tested and loaded by plain Node scripts.

/** opencode prefixes MCP tools with this server key: finmon_<tool>. */
export const MCP_KEY = "finmon";
export const AGENT_NAME = "finmon";

export const SYSTEM_PROMPT = `You are the finmon assistant, built into a personal finance tracker.
You help the signed-in user understand and maintain their own records: transactions (income/spend, with optional product line items and a status), categories (name + priority 0–10) and monthly plans (budget per category per month).

Rules:
- You can only use the finmon tools. You have no shell, files, web or code tools; if asked for anything outside the user's finmon data, say you can't do that.
- Look data up with the tools instead of guessing ids or amounts. Use the user's existing categories; don't create a new category unless the user asks for one.
- Write tools (create/update/delete/verify/set_plan…) do NOT change anything by themselves: each call creates a proposal that the user must Accept (in the chat or on the Suggestions page). After proposing, tell the user briefly what you proposed and that it's waiting for their approval. Never claim a change was made unless you're told the user accepted it.
- Propose only changes the user asked for. If the request is ambiguous (which transaction? what amount?), ask first.
- Dates are YYYY-MM-DD, months are YYYY-MM. Amounts are in the user's currency; don't add a currency symbol.
- Be concise. Replies are rendered as Markdown: use short lists or small GitHub-style tables (at most 4 columns, short cells) for numbers.`;

/** Per-message system text for a turn whose user message carries a receipt
 *  photo. Those turns only get the scan_receipt, create_transaction and
 *  replace_receipt_photo tools, plus the two transaction reads. */
export const RECEIPT_SYSTEM_PROMPT = `The user attached a receipt photo to this message, marked "[Image attached: receipt #<id>]". You cannot see the image. Read it with the scan_receipt tool (receipt_id = that id).
- Check the scan: it should have a total and line items, the product costs (product_cost_sum) should roughly add up to the total, and the date and store should look plausible. If the result looks wrong or empty, call scan_receipt again (at most 2 retries); every call re-reads the photo.
- Then call create_transaction once: type "spend", amount = the scanned total, date = the scanned date (or today if missing), store, receipt_id, and category_name = one of the user's existing categories (the scan suggests one; never set new_category). If the user's message says otherwise (another category, amount, date), follow the user.
- If the user says the photo belongs to a transaction they already have, find it with search_transactions/get_transaction and call replace_receipt_photo (transaction_id, receipt_id) instead — it replaces that transaction's photo and line items. Ask which one if it's not clear.
- If the scan keeps failing, tell the user and don't create anything.
- Afterwards briefly summarize what you read (store, date, total, number of items) and that the transaction is waiting for their approval.`;

/** Provider key for a LiteLLM (OpenAI-compatible) server: models are `litellm/<model>`. */
export const LITELLM_PROVIDER = "litellm";

/**
 * Custom opencode provider registering every selectable `litellm/<model>`
 * model. The API key stays an `{env:…}` placeholder, resolved from the
 * opencode process's environment, so the real key is never written into the
 * per-user config files.
 */
function litellmProvider(modelIds: string[], baseURL: string | undefined) {
  if (!baseURL || modelIds.length === 0) return undefined;
  return {
    [LITELLM_PROVIDER]: {
      npm: "@ai-sdk/openai-compatible",
      name: "LiteLLM",
      options: { baseURL, apiKey: "{env:LITELLM_API_KEY}" },
      models: Object.fromEntries(modelIds.map((id) => [id, { name: id }])),
    },
  };
}

export function buildOpencodeConfig(
  token: string,
  e: { mcpUrl: string; model: string; litellmBaseUrl?: string; litellmModels?: string[] },
) {
  const denyAll = { "*": "deny", [`${MCP_KEY}_*`]: "allow" };
  const prefix = `${LITELLM_PROVIDER}/`;
  const litellmIds = [
    ...new Set([
      ...(e.model.startsWith(prefix) ? [e.model.slice(prefix.length)] : []),
      ...(e.litellmModels ?? []),
    ]),
  ];
  const provider = litellmProvider(litellmIds, e.litellmBaseUrl);
  return {
    $schema: "https://opencode.ai/config.json",
    model: e.model,
    small_model: e.model,
    ...(provider && { provider }),
    default_agent: AGENT_NAME,
    share: "disabled",
    autoupdate: false,
    snapshot: false,
    plugin: [],
    instructions: [],
    // Legacy tool switches (deny everything but finmon) plus the permission
    // ruleset — belt and braces across opencode versions.
    tools: { "*": false, [`${MCP_KEY}_*`]: true },
    permission: denyAll,
    agent: {
      [AGENT_NAME]: {
        mode: "primary",
        description: "finmon personal-finance assistant",
        prompt: SYSTEM_PROMPT,
        steps: 12,
        tools: { "*": false, [`${MCP_KEY}_*`]: true },
        permission: denyAll,
      },
      build: { disable: true },
      plan: { disable: true },
      general: { disable: true },
      explore: { disable: true },
    },
    mcp: {
      [MCP_KEY]: {
        type: "remote",
        url: e.mcpUrl,
        enabled: true,
        oauth: false,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  };
}
