import "server-only";
import { z } from "zod";
import type { ProductFields } from "@/actions/products";

/** Result of scanning a receipt image: the parsed line items mapped straight to
 *  product fields, plus the store/total the model read off the receipt (used for
 *  context/logging only — `transactions.amount` stays authoritative). */
export type ScanResult = {
  store: string | null;
  total: number | null;
  products: ProductFields[];
};

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
/** Hard ceiling on the OpenAI call. Without it a hung request would never reach
 *  the caller's `finally`, leaving the transaction stuck on `processing`. */
const REQUEST_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `You are a receipt parser. You are given a photo of a store \
receipt and must extract its line items as structured data. Rules:
- One object per purchased line item. Skip subtotals, totals, tax, discounts, \
loyalty messages, and store metadata — those are not products.
- "name" is the item name as printed (cleaned up, title case if it's all-caps).
- "cost" is the total price paid for that line (price x quantity), as a positive \
number with no currency symbol.
- "amount" is the quantity and "unit" its unit (e.g. 2 / "kg", 1 / "pcs") only \
when the receipt shows them; otherwise null.
- "price" is the per-unit price only when shown separately; otherwise null.
- "brand", "product_type", "description" only when evident; otherwise null.
- "tags" is a short list of lowercase keywords (e.g. ["dairy"]); [] if unsure.
- "store" is the merchant name and "total" the receipt grand total, or null.
- Use null for anything you cannot read confidently. Do not invent values.`;

/** Strict structured-output schema. OpenAI strict mode requires every property to
 *  be listed in `required` and optionality expressed as nullable types. */
const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    store: { type: ["string", "null"] },
    total: { type: ["number", "null"] },
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
          description: { type: ["string", "null"] },
          price: { type: ["number", "null"] },
          amount: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
        },
        required: [
          "name",
          "brand",
          "cost",
          "product_type",
          "tags",
          "description",
          "price",
          "amount",
          "unit",
        ],
      },
    },
  },
  required: ["store", "total", "products"],
} as const;

/** Defensive parse of the model's JSON — strict mode should already guarantee the
 *  shape, but never trust the network. Unknown keys are stripped. */
const ProductSchema = z.object({
  name: z.string(),
  brand: z.string().nullable().optional(),
  cost: z.number().nullable().optional(),
  product_type: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  description: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  amount: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
});

const ResultSchema = z.object({
  store: z.string().nullable().optional(),
  total: z.number().nullable().optional(),
  products: z.array(ProductSchema),
});

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
 * line items as product fields. One LLM call. Throws on missing API key or a
 * failed/unparseable response — callers surface that as a friendly error.
 */
export async function scanReceipt(imageDataUrl: string): Promise<ScanResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Receipt scanning is unavailable (OPENAI_API_KEY is not set)");
  }
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

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
          { role: "system", content: SYSTEM_PROMPT },
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
          json_schema: { name: "receipt", strict: true, schema: RESPONSE_SCHEMA },
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
      description: trimOrNull(p.description),
      price: positiveOrNull(p.price),
      amount: positiveOrNull(p.amount),
      unit: trimOrNull(p.unit),
    }))
    // A line item with no name can't be stored (name is the one required field).
    .filter((p) => p.name.length > 0);

  return {
    store: trimOrNull(parsed.store),
    total: positiveOrNull(parsed.total),
    products,
  };
}
