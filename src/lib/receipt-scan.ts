import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ProductFields } from "@/actions/products";
import rawExamples from "@/lib/receipt-examples.json";
import rawUnits from "@/lib/receipt-units.json";

/** Result of scanning a receipt image: the parsed line items mapped straight to
 *  product fields, plus the store, grand total, purchase date and best-fit
 *  category the model read off the receipt. The scan action stores `total` in
 *  `receipts.total` and uses the rest to fill in transaction fields the user
 *  left blank — a manually entered `transactions.amount` stays authoritative. */
export type ScanResult = {
  store: string | null;
  /** The receipt's printed grand total — always the FINAL amount paid, with
   *  every discount (per-item or check-wide) already reflected. Nothing is
   *  ever subtracted from it. Per-item discounts ride on the products. */
  total: number | null;
  date: string | null;
  category: string | null;
  products: ProductFields[];
};

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
/** Hard ceiling on the OpenAI call. Without it a hung request would never reach
 *  the caller's `finally`, leaving the transaction stuck on `processing`. */
const REQUEST_TIMEOUT_MS = 60_000;

/** A few-shot example, authored in `receipt-examples.json`. `note` is a
 *  maintainer-only annotation describing the receipt — it is added manually and
 *  is NEVER sent to the model (not part of the output schema, not rendered into
 *  the prompt). `output` is the exact JSON the model should produce. */
type ReceiptExample = { note?: string; output: unknown };

/** The prompt is composed at runtime from the human-edited rules in
 *  `receipt-prompt.md` (placeholders `{{UNITS}}` and `{{EXAMPLES}}` mark where the
 *  allowed-unit list and few-shot block go) plus the config in
 *  `receipt-units.json` and `receipt-examples.json`. Keeping them out of the
 *  source lets the prompt, its units and its examples be tuned without touching
 *  code. The `.md` is read from disk, so it's traced into the standalone build via
 *  `outputFileTracingIncludes` in `next.config.ts`; the JSON is bundled by the
 *  imports above. */
const PROMPT_TEMPLATE_PATH = path.join(process.cwd(), "src", "lib", "receipt-prompt.md");
const EXAMPLES = rawExamples as ReceiptExample[];
const UNITS = rawUnits as string[];

/** Render the examples as a block of pretty-printed JSON outputs. `note` is
 *  intentionally not rendered — the model only ever sees the output JSON it
 *  should reproduce. */
function renderExamples(examples: ReceiptExample[]): string {
  if (examples.length === 0) return "";
  const blocks = examples.map(
    (ex, i) => `Example ${i + 1}:\n${JSON.stringify(ex.output, null, 2)}`,
  );
  return `Examples (each shows the exact JSON to produce for a receipt):\n\n${blocks.join(
    "\n\n",
  )}`;
}

/** Compose + cache the prompt template with the static substitutions (units,
 *  examples) baked in. Read once on first use, not at import, so a missing file
 *  surfaces as a scan-time error rather than a module-load crash. The
 *  `{{CATEGORIES}}` placeholder is left in — it varies per user, so it's
 *  substituted per call in `getSystemPrompt`. */
let cachedPromptTemplate: string | null = null;
function getPromptTemplate(): string {
  if (cachedPromptTemplate === null) {
    const template = readFileSync(PROMPT_TEMPLATE_PATH, "utf8");
    const units = UNITS.map((u) => `"${u}"`).join(", ");
    const examples = renderExamples(EXAMPLES);
    const withUnits = template.replace("{{UNITS}}", units);
    cachedPromptTemplate = (
      withUnits.includes("{{EXAMPLES}}")
        ? withUnits.replace("{{EXAMPLES}}", examples)
        : `${withUnits.trimEnd()}\n\n${examples}`
    ).trim();
  }
  return cachedPromptTemplate;
}

function getSystemPrompt(categoryNames: string[]): string {
  const categories = [...categoryNames.map((n) => JSON.stringify(n)), '"other"'].join(", ");
  return getPromptTemplate().replace("{{CATEGORIES}}", categories);
}

/** The user's category names as offered to the model: trimmed, deduped, blanks
 *  dropped, and the literal "other" fallback excluded (it's appended separately
 *  everywhere the list is used, so it appears exactly once). */
function normalizeCategoryNames(names: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name.length > 0 && name !== "other") seen.add(name);
  }
  return [...seen];
}

/** Strict structured-output schema. OpenAI strict mode requires every property to
 *  be listed in `required` and optionality expressed as nullable types. Built per
 *  call because `category` is an enum of the user's own category names (plus the
 *  literal "other" fallback) — the model can only ever answer with one of them. */
const buildResponseSchema = (categoryNames: string[]) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    store: { type: ["string", "null"] },
    total: { type: ["number", "null"] },
    date: { type: ["string", "null"] },
    category: { type: "string", enum: [...categoryNames, "other"] },
    products: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          brand: { type: ["string", "null"] },
          cost: { type: ["number", "null"] },
          product_type: { type: ["string", "null"] },
          tags: { type: "array", items: { type: "string" } },
          price: { type: ["number", "null"] },
          amount: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          discount: { type: ["number", "null"] },
        },
        required: [
          "name",
          "brand",
          "cost",
          "product_type",
          "tags",
          "price",
          "amount",
          "unit",
          "discount",
        ],
      },
    },
  },
  required: ["store", "total", "date", "category", "products"],
});

/** Defensive parse of the model's JSON — strict mode should already guarantee the
 *  shape, but never trust the network. Unknown keys are stripped. */
const ProductSchema = z.object({
  name: z.string(),
  brand: z.string().nullable().optional(),
  cost: z.number().nullable().optional(),
  product_type: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  price: z.number().nullable().optional(),
  amount: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  discount: z.number().nullable().optional(),
});

const ResultSchema = z.object({
  store: z.string().nullable().optional(),
  total: z.number().nullable().optional(),
  date: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  products: z.array(ProductSchema),
});

/** The scanned purchase date is only usable in the transaction's date format. */
const SCAN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const trimOrNull = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
};

/** Keep only finite positive numbers — the products table CHECKs reject <= 0,
 *  and a 0/negative cost on a receipt line is noise. */
const positiveOrNull = (n: number | null | undefined): number | null =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;

/**
 * Send a receipt image (a `data:` URL) to the OpenAI vision model and return its
 * line items as product fields plus the receipt-level fields (store, total,
 * date, category). `categoryNames` is the user's category list — it's rendered
 * into the prompt and enforced as an enum in the response schema, so `category`
 * is always byte-exact one of the names or the literal "other". One LLM call.
 * Throws on missing API key or a failed/unparseable response — callers surface
 * that as a friendly error.
 */
export async function scanReceipt(
  imageDataUrl: string,
  categoryNames: string[],
): Promise<ScanResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Receipt scanning is unavailable (OPENAI_API_KEY is not set)");
  }
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const categories = normalizeCategoryNames(categoryNames);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let parsed: z.infer<typeof ResultSchema>;
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: getSystemPrompt(categories) },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the line items from this receipt." },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "receipt",
            strict: true,
            schema: buildResponseSchema(categories),
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI request failed (${res.status}): ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    const content: unknown = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("OpenAI returned no content");
    }

    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      throw new Error("OpenAI returned malformed JSON");
    }

    parsed = ResultSchema.parse(json);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `OpenAI request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const products: ProductFields[] = parsed.products
    .map((p) => ({
      name: (p.name ?? "").trim(),
      brand: trimOrNull(p.brand),
      cost: positiveOrNull(p.cost),
      product_type: trimOrNull(p.product_type),
      tags: (p.tags ?? []).map((t) => t.trim()).filter((t) => t.length > 0),
      // `description` is never AI-populated — it's typed in manually later.
      description: null,
      price: positiveOrNull(p.price),
      amount: positiveOrNull(p.amount),
      unit: trimOrNull(p.unit),
      discount: positiveOrNull(p.discount),
    }))
    // A line item with no name can't be stored (name is the one required field).
    .filter((p) => p.name.length > 0);

  const date = trimOrNull(parsed.date);
  return {
    store: trimOrNull(parsed.store),
    total: positiveOrNull(parsed.total),
    // A date in any other format can't be stored on the transaction.
    date: date !== null && SCAN_DATE_RE.test(date) ? date : null,
    category: trimOrNull(parsed.category),
    products,
  };
}
