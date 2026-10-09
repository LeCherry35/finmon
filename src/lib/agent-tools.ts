import "server-only";
import { z } from "zod";
import { pool } from "@/db";
import {
  getAvailableMonths,
  getCategories,
  getCategory,
  getPlansForMonth,
  getProduct,
  getTransaction,
  getTransactions,
  summarizeTransactions,
  type TransactionFilters,
} from "@/db/queries";
import {
  createTransactionFor,
  deleteTransactionFor,
  updateTransactionFor,
} from "@/lib/mutations/transactions";
import {
  addProductFor,
  deleteProductFor,
  insertProducts,
  parseProductFields,
  recomputeTransactionStatus,
  updateProductFor,
} from "@/lib/mutations/products";
import { createCategoryFor, updateCategoryFor } from "@/lib/mutations/categories";
import { upsertPlanFor } from "@/lib/mutations/plans";
import { toImageDataUrl } from "@/lib/image-data-url";
import { scanReceipt, type ScanResult } from "@/lib/receipt-scan";
import {
  applyScanToTransaction,
  deleteTransactionProducts,
  getStoredReceipt,
  saveReceiptScan,
  upsertReceipt,
  type StoredReceipt,
} from "@/lib/receipts";
import type { Transaction } from "@/actions/transactions";
import type { ProductFields } from "@/actions/products";

// The complete set of things the finmon agent can do. The MCP route
// (/api/agent/mcp) exposes exactly these tools and nothing else; opencode is
// configured with no built-in tools, so this file IS the agent's permission
// boundary.
//
// Every tool runs with the userId from the verified MCP token — never from the
// model's input. `requiresApproval` decides how a call is handled:
//   false → `run` executes immediately and its result goes back to the model.
//   true  → the call is stored as an `agent_proposals` row (after `describe`
//           has checked the target exists and built a human-readable summary);
//           `run` only executes when the user clicks Accept
//           (src/actions/agent.ts).

export type AgentTool = {
  name: string;
  description: string;
  input: z.ZodObject;
  requiresApproval: boolean;
  /** Approval tools: validate the call against current data and summarize it
   *  for the user. Throws AgentToolError when the call can't be proposed. */
  describe?: (userId: string, input: never) => Promise<string>;
  run: (userId: string, input: never) => Promise<unknown>;
};

/** An expected, user-facing failure (bad id, validation) — reported back to the
 *  model as a tool error rather than a 500. */
export class AgentToolError extends Error {}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const MONTH = z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM");
/** Numbers from the model: some models send `"100"` instead of `100`, so
 *  numeric strings are accepted. The JSON schema still advertises a number. */
const num = <S extends z.ZodNumber>(schema: S) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v),
    schema,
  );
const ID = num(z.number().int().positive());
const MONEY = num(z.number().positive());

/** Tool input → the FormData the shared mutation functions validate. null
 *  clears a field (blank), arrays (tags) become comma-separated. */
function toFormData(fields: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    fd.set(k, v === null ? "" : Array.isArray(v) ? v.join(",") : String(v));
  }
  return fd;
}

/** Throw the mutation's validation error so the proposal is marked failed. */
function unwrap<T extends { ok: boolean; error?: string }>(result: T): T {
  if (!result.ok) throw new AgentToolError(result.error ?? "Failed");
  return result;
}

const fmt = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") || "—" : String(v);

/** "field: old → new" lines for the fields a partial update actually changes. */
function diffLines(current: Record<string, unknown>, patch: Record<string, unknown>): string[] {
  return Object.entries(patch)
    .filter(([k, v]) => v !== undefined && fmt(current[k]) !== fmt(v))
    .map(([k, v]) => `${k}: ${fmt(current[k])} → ${fmt(v)}`);
}

async function requireTransaction(userId: string, id: number): Promise<Transaction> {
  const tx = await getTransaction(userId, id);
  if (!tx) throw new AgentToolError(`Transaction ${id} not found`);
  return tx;
}

/** Every listed transaction (duplicates dropped), or an error naming the missing ones. */
async function requireTransactions(userId: string, ids: number[]): Promise<Transaction[]> {
  const unique = [...new Set(ids)];
  const rows = await Promise.all(unique.map((id) => getTransaction(userId, id)));
  const missing = unique.filter((_, n) => !rows[n]);
  if (missing.length > 0) throw new AgentToolError(`Transactions not found: ${missing.join(", ")}`);
  return rows as Transaction[];
}

function txLabel(t: Pick<Transaction, "id" | "type" | "amount" | "date" | "store" | "category_name">) {
  return `#${t.id} ${t.type} ${fmt(t.amount)} on ${t.date}${t.store ? ` at ${t.store}` : ""}${
    t.category_name ? ` (${t.category_name})` : ""
  }`;
}

/** The user's categories plus the one matching `name` (trimmed,
 *  case-insensitive), so "food" reuses an existing "Food". */
async function resolveCategoryName(userId: string, name: string) {
  const all = await getCategories(userId);
  return { category: findCategory(all, name), all };
}

function findCategory<C extends { name: string }>(all: C[], name: string): C | null {
  const key = name.trim().toLocaleLowerCase();
  return all.find((c) => c.name === name.trim()) ?? all.find((c) => c.name.toLocaleLowerCase() === key) ?? null;
}

/** "3: Groceries, 5: Transport" — handed to the model when it names a category
 *  that doesn't exist. */
function categoryListText(all: { id: number; name: string }[]): string {
  return all.length ? all.map((c) => `${c.id}: ${c.name}`).join(", ") : "none yet";
}

/** The transaction fields the model sees — no status, ids of other tables or
 *  user ids, which are only noise to it. */
function transactionView(t: Transaction) {
  return {
    id: t.id,
    date: t.date,
    type: t.type,
    amount: t.amount,
    scanned_total: t.scanned_total ?? null,
    category_id: t.category_id,
    category_name: t.category_name ?? null,
    store: t.store,
    note: t.note,
  };
}

/** Keep search results compact for the model's context. */
function compactTransaction(t: Transaction) {
  return {
    ...transactionView(t),
    products: (t.products ?? []).map((p) => ({ id: p.id, name: p.name, cost: p.cost })),
  };
}

type Attachment = { id: number; image: Buffer; content_type: string; scan: ScanResult | null };

/** A receipt photo the user attached in the chat (agent_attachments), only their own. */
async function requireAttachment(userId: string, id: number): Promise<Attachment> {
  const { rows } = await pool.query<Attachment>(
    "SELECT id, image, content_type, scan FROM agent_attachments WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  if (!rows[0]) throw new AgentToolError(`Receipt ${id} not found`);
  return rows[0];
}

/** The attachment's latest scan — create_transaction attaches exactly that. */
async function requireScannedAttachment(userId: string, id: number) {
  const attachment = await requireAttachment(userId, id);
  if (!attachment.scan) throw new AgentToolError(`Receipt ${id} hasn't been scanned yet — call scan_receipt first`);
  return { ...attachment, scan: attachment.scan };
}

/** The receipt photo stored on one of the user's transactions. */
async function requireStoredReceipt(userId: string, transactionId: number): Promise<StoredReceipt> {
  await requireTransaction(userId, transactionId);
  const receipt = await getStoredReceipt(userId, transactionId);
  if (!receipt) throw new AgentToolError(`Transaction ${transactionId} has no stored receipt photo`);
  return receipt;
}

/** The stored receipt's latest scan — what apply_receipt_scan applies. */
async function requireScannedReceipt(userId: string, transactionId: number) {
  const receipt = await requireStoredReceipt(userId, transactionId);
  if (!receipt.scan)
    throw new AgentToolError(
      `The receipt of transaction ${transactionId} hasn't been scanned yet — call scan_receipt first`,
    );
  return { ...receipt, scan: receipt.scan };
}

/** The tool's line items → validated product fields, by the products modal's rules. */
function parseProducts(items: Record<string, unknown>[]): ProductFields[] {
  return items.map((item, n) => {
    const parsed = parseProductFields(toFormData(item));
    if ("error" in parsed) throw new AgentToolError(`Product ${n + 1}: ${parsed.error}`);
    return parsed;
  });
}

const costSum = (products: { cost: number | null }[]) =>
  round2(products.reduce((sum, p) => sum + (p.cost ?? 0), 0));

/** One OpenAI vision call on a receipt photo, with the user's category names. */
async function readReceipt(userId: string, image: Buffer, contentType: string, label: string) {
  const categories = await getCategories(userId);
  try {
    return await scanReceipt(toImageDataUrl(image, contentType), categories.map((c) => c.name));
  } catch (err) {
    console.error(`scan_receipt ${label} failed:`, err instanceof Error ? err.message : err);
    throw new AgentToolError("Scanning the receipt failed. Try again, or tell the user.");
  }
}

/** The scan as the model reads it back. */
function scanSummary(scan: ScanResult) {
  return {
    store: scan.store,
    total: scan.total,
    date: scan.date,
    suggested_category: scan.category,
    product_cost_sum: costSum(scan.products),
    products: scan.products.map((p) => ({ name: p.name, cost: p.cost, amount: p.amount, unit: p.unit })),
  };
}

/** Replace a transaction's line items with a scan's, then re-derive its status.
 *  The products modal's re-scan does the same (src/actions/receipt.ts). */
async function applyScan(userId: string, transactionId: number, scan: ScanResult) {
  const categories = await getCategories(userId);
  try {
    await deleteTransactionProducts(userId, transactionId);
    await applyScanToTransaction(userId, transactionId, scan, categories);
  } finally {
    await recomputeTransactionStatus(userId, transactionId);
  }
  return { transaction_id: transactionId, products: scan.products.length, total: scan.total };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** summarize_transactions returns at most this many groups (and groups_total). */
const MAX_SUMMARY_GROUPS = 100;
/** Most rows one bulk proposal (update_transactions, set_plans) may touch. */
const MAX_BULK = 100;
/** Transactions listed by name on a bulk proposal's card. */
const SUMMARY_ROWS = 10;

/** A transaction as an update_transactions card compares it: category by name. */
const shownFields = (t: Transaction) => ({
  type: t.type,
  amount: t.amount,
  date: t.date,
  note: t.note,
  store: t.store,
  category: t.category_name ?? null,
});

/** update_transactions input → the form fields to merge (`patch`, category by
 *  id) and the same change as the card shows it (`shown`, category by name). */
async function transactionPatch(
  userId: string,
  { category_name, ...fields }: Omit<In<typeof updateTransactionsInput>, "ids">,
) {
  const patch: Record<string, unknown> = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  );
  const shown: Record<string, unknown> = { ...patch };
  if (category_name === null || category_name?.trim() === "") {
    patch.category_id = null;
    shown.category = null;
  } else if (category_name !== undefined) {
    const { category, all } = await resolveCategoryName(userId, category_name);
    if (!category)
      throw new AgentToolError(
        `Category "${category_name.trim()}" doesn't exist. Existing categories: ${categoryListText(all)}`,
      );
    patch.category_id = category.id;
    shown.category = category.name;
  }
  return { patch, shown };
}

/** set_plans entries → the user's categories they name; unknown or repeated names fail. */
async function resolvePlans(userId: string, plans: { category_name: string; amount: number }[]) {
  const all = await getCategories(userId);
  const resolved = plans.map((p) => ({ name: p.category_name.trim(), category: findCategory(all, p.category_name), amount: p.amount }));
  const unknown = resolved.filter((p) => !p.category).map((p) => `"${p.name}"`);
  if (unknown.length > 0)
    throw new AgentToolError(`Unknown categories: ${unknown.join(", ")}. Existing categories: ${categoryListText(all)}`);
  const ids = resolved.map((p) => p.category!.id);
  if (new Set(ids).size !== ids.length) throw new AgentToolError("Each category may appear only once");
  return resolved.map((p) => ({ category: p.category!, amount: p.amount }));
}

// ---------------------------------------------------------------------------
// Input schemas

/** Filters shared by search_transactions and summarize_transactions. */
const filterFields = {
  months: z.array(MONTH).optional().describe("Only these months (YYYY-MM). Omit for all time."),
  date_from: DATE.optional().describe("On or after this date."),
  date_to: DATE.optional().describe("On or before this date."),
  category_ids: z.array(ID).optional().describe("Only these category ids."),
  uncategorized: z.boolean().optional().describe("Only uncategorized rows (or also them, with category_ids)."),
  type: z.enum(["income", "spend"]).optional(),
  amount_min: num(z.number().min(0)).optional(),
  amount_max: num(z.number().min(0)).optional(),
  query: z
    .preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.string().max(100)).max(10))
    .optional()
    .describe(
      "Text matched against store, note, category and product names/brands/types/tags. Several terms match ANY of them — pass spelling variants and synonyms together (e.g. [\"fuel\", \"gas station\", \"Shell\"]).",
    ),
};

type FilterInput = { [K in keyof typeof filterFields]?: z.infer<(typeof filterFields)[K]> };

function toFilters(i: FilterInput): TransactionFilters {
  return {
    months: i.months,
    categoryIds: i.category_ids ?? null,
    dateFrom: i.date_from,
    dateTo: i.date_to,
    type: i.type,
    uncategorized: i.uncategorized,
    amountMin: i.amount_min,
    amountMax: i.amount_max,
  };
}

const searchTransactionsInput = z.object({
  ...filterFields,
  sort: z
    .enum(["date", "added", "amount"])
    .optional()
    .describe("date (default) = newest transaction date first, added = newest entries first, amount = largest first."),
  limit: num(z.number().int().min(1).max(200)).optional().describe("Max rows returned (default 50)."),
  offset: num(z.number().int().min(0)).optional().describe("Skip this many rows (paging)."),
  include_products: z
    .boolean()
    .optional()
    .describe("Include each row's line items (id, name, cost). Default false: rows carry product_count only."),
});

const summarizeInput = z.object({
  ...filterFields,
  type: filterFields.type.describe("Default spend. Pass income, or group_by type for both."),
  group_by: z.enum(["category", "month", "store", "type", "product", "none"]),
  of: z
    .enum(["transactions", "products"])
    .optional()
    .describe(
      "transactions (default) sums transaction amounts. products sums line-item costs, and query then matches the line items themselves — use it for a product bought inside bigger receipts (e.g. coffee among groceries). group_by product needs it.",
    ),
});

const transactionFields = {
  type: z.enum(["income", "spend"]),
  amount: MONEY.nullable().optional().describe("Positive amount. null clears it."),
  date: DATE,
  note: z.string().max(500).nullable().optional(),
  store: z.string().max(200).nullable().optional().describe("Merchant name."),
};

const scanReceiptInput = z
  .object({
    receipt_id: ID.optional().describe("A photo attached in this chat, from its [Image attached: receipt #<id>] marker."),
    transaction_id: ID.optional().describe("Re-read the receipt photo already stored on this transaction."),
  })
  .refine((i) => (i.receipt_id === undefined) !== (i.transaction_id === undefined), {
    message: "Pass exactly one of receipt_id (a chat photo) or transaction_id (a stored receipt)",
  });

const productFields = {
  name: z.string().min(1).max(200),
  brand: z.string().max(200).nullable().optional(),
  cost: MONEY.nullable().optional().describe("Final amount paid for this line, discount already applied."),
  price: MONEY.nullable().optional().describe("Unit price."),
  amount: MONEY.nullable().optional().describe("Quantity."),
  unit: z.string().max(50).nullable().optional(),
  discount: MONEY.nullable().optional().describe("Money taken off this line (informational; cost already includes it)."),
  product_type: z.string().max(100).nullable().optional(),
  tags: z.array(z.string().max(50)).optional(),
  description: z.string().max(500).nullable().optional(),
};

const createTransactionInput = z.object({
  ...transactionFields,
  category_name: z
    .string()
    .max(100)
    .optional()
    .describe(
      "One of the user's existing categories (case-insensitive). If unsure, pass your best guess — an unknown name returns the list of existing categories.",
    ),
  new_category: z
    .boolean()
    .optional()
    .describe("Set true only if the user explicitly wants a new category named category_name."),
  receipt_id: ID.optional().describe(
    "A scanned chat receipt photo: its image and latest scan's line items are attached to the transaction.",
  ),
  products: z
    .array(z.object(productFields))
    .min(1)
    .max(50)
    .optional()
    .describe("Line items the user listed (not with receipt_id, whose scan brings its own)."),
});

const updateTransactionsInput = z.object({
  ids: z.array(ID).min(1).max(MAX_BULK).describe("One or more transactions; all get the same new values."),
  type: transactionFields.type.optional(),
  amount: transactionFields.amount,
  date: DATE.optional(),
  note: transactionFields.note,
  store: transactionFields.store,
  category_name: z
    .string()
    .max(100)
    .nullable()
    .optional()
    .describe("One of the user's existing categories (case-insensitive). null makes them uncategorized."),
});
const addProductInput = z.object({ transaction_id: ID, ...productFields });
const updateProductInput = z.object({
  id: ID,
  ...productFields,
  name: productFields.name.optional(),
});

const createCategoryInput = z.object({
  name: z.string().min(1).max(100),
  priority: num(z.number().int().min(0).max(10)).optional().describe("0–10, default 5."),
});
const updateCategoryInput = z.object({
  id: ID,
  name: z.string().min(1).max(100).optional(),
  priority: num(z.number().int().min(0).max(10)).optional(),
});

const setPlansInput = z.object({
  month: MONTH,
  plans: z
    .array(
      z.object({
        category_name: z.string().min(1).max(100).describe("One of the user's existing categories."),
        amount: num(z.number().min(0)).describe("Planned spend for the month; 0 is allowed."),
      }),
    )
    .min(1)
    .max(MAX_BULK),
});

const idInput = z.object({ id: ID });

type In<S extends z.ZodType> = z.infer<S>;

// ---------------------------------------------------------------------------
// Registry

function tool<S extends z.ZodObject>(def: {
  name: string;
  description: string;
  input: S;
  requiresApproval: boolean;
  describe?: (userId: string, input: In<S>) => Promise<string>;
  run: (userId: string, input: In<S>) => Promise<unknown>;
}): AgentTool {
  return def as unknown as AgentTool;
}

export const AGENT_TOOLS: AgentTool[] = [
  // ---- reads: run immediately ----
  tool({
    name: "list_categories",
    description: "List the user's categories (id, name, priority 0–10).",
    input: z.object({}),
    requiresApproval: false,
    run: async (userId) =>
      (await getCategories(userId)).map(({ id, name, priority }) => ({ id, name, priority })),
  }),
  tool({
    name: "list_months",
    description: "Months (YYYY-MM) that have any transactions or plans, newest first.",
    input: z.object({}),
    requiresApproval: false,
    run: (userId) => getAvailableMonths(userId),
  }),
  tool({
    name: "search_transactions",
    description:
      "Find transactions. amount is null when only a scanned receipt total exists — then scanned_total is what it counts as. For totals use summarize_transactions instead of adding rows up.",
    input: searchTransactionsInput,
    requiresApproval: false,
    run: async (userId, i) => {
      const rows = await getTransactions(userId, toFilters(i), i.sort ?? "date", i.query);
      const offset = i.offset ?? 0;
      const page = rows.slice(offset, offset + (i.limit ?? 50));
      return {
        total_matches: rows.length,
        returned: page.length,
        transactions: page.map((t) =>
          i.include_products
            ? compactTransaction(t)
            : { ...transactionView(t), product_count: t.products?.length ?? 0 },
        ),
      };
    },
  }),
  tool({
    name: "get_transaction",
    description: "One transaction with all product line item details.",
    input: idInput,
    requiresApproval: false,
    run: async (userId, i) => {
      // receipt_id is a receipts row id — a different id space from
      // scan_receipt's receipt_id (a chat attachment), so don't hand it over.
      const tx = await requireTransaction(userId, i.id);
      return {
        ...transactionView(tx),
        has_receipt: tx.receipt_id != null,
        products: (tx.products ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          brand: p.brand,
          cost: p.cost,
          price: p.price,
          amount: p.amount,
          unit: p.unit,
          discount: p.discount,
          product_type: p.product_type,
          tags: p.tags,
          description: p.description,
        })),
      };
    },
  }),
  tool({
    name: "summarize_transactions",
    description:
      "Totals and counts computed by the database — use it for any sum, average or comparison instead of adding numbers yourself. Groups are largest first (months in calendar order); category key 0 = Uncategorized.",
    input: summarizeInput,
    requiresApproval: false,
    run: async (userId, { group_by, of = "transactions", ...i }) => {
      if (group_by === "product" && of !== "products")
        throw new AgentToolError('group_by "product" needs of: "products"');
      const filters = toFilters({ ...i, type: i.type ?? (group_by === "type" ? undefined : "spend") });
      const rows = await summarizeTransactions(userId, filters, i.query, group_by, of);
      return {
        total: round2(rows.reduce((sum, r) => sum + r.total, 0)),
        count: rows.reduce((sum, r) => sum + r.count, 0),
        groups_total: rows.length,
        groups: rows.slice(0, MAX_SUMMARY_GROUPS).map((r) => ({ ...r, total: round2(r.total) })),
      };
    },
  }),
  tool({
    name: "get_plans",
    description: "Planned vs spent per category for one month. amount null = no plan set.",
    input: z.object({ month: MONTH }),
    requiresApproval: false,
    run: (userId, i) => getPlansForMonth(userId, i.month),
  }),
  tool({
    name: "scan_receipt",
    description:
      "Read a receipt photo: receipt_id = one the user attached in this chat ([Image attached: receipt #<id>]), transaction_id = the photo already stored on a transaction. Every call re-reads the image, so call again if the result looks wrong; the latest scan is what create_transaction / apply_receipt_scan uses.",
    input: scanReceiptInput,
    requiresApproval: false,
    run: async (userId, i) => {
      if (i.transaction_id !== undefined) {
        const receipt = await requireStoredReceipt(userId, i.transaction_id);
        const scan = await readReceipt(
          userId,
          receipt.image,
          receipt.content_type,
          `transaction ${i.transaction_id}`,
        );
        await saveReceiptScan(userId, i.transaction_id, scan);
        return { transaction_id: i.transaction_id, ...scanSummary(scan) };
      }
      const attachment = await requireAttachment(userId, i.receipt_id!);
      const scan = await readReceipt(
        userId,
        attachment.image,
        attachment.content_type,
        `attachment ${attachment.id}`,
      );
      await pool.query("UPDATE agent_attachments SET scan = $1 WHERE id = $2 AND user_id = $3", [
        JSON.stringify(scan),
        attachment.id,
        userId,
      ]);
      return { receipt_id: attachment.id, ...scanSummary(scan) };
    },
  }),

  // ---- writes: proposals the user must accept ----
  tool({
    name: "create_transaction",
    description:
      "Propose a new transaction. Needs at least an amount, a category or a scanned receipt_id.",
    input: createTransactionInput,
    requiresApproval: true,
    describe: async (userId, i) => {
      if (i.receipt_id && i.products)
        throw new AgentToolError("Pass products or receipt_id, not both — a receipt brings its own line items");
      const products = i.products ? parseProducts(i.products) : null;
      const receipt = i.receipt_id ? await requireScannedAttachment(userId, i.receipt_id) : null;
      if (i.amount == null && !i.category_name?.trim() && !receipt)
        throw new AgentToolError("Add an amount or a category");
      let category = "—";
      if (i.category_name?.trim()) {
        const { category: match, all } = await resolveCategoryName(userId, i.category_name);
        if (match) category = match.name;
        else if (i.new_category) category = `${i.category_name.trim()} (NEW category)`;
        else
          throw new AgentToolError(
            `Category "${i.category_name.trim()}" doesn't exist. Existing categories: ${categoryListText(all)}. ` +
              "Use one of these, or pass new_category: true if the user wants a new one.",
          );
      }
      return [
        `Create ${i.type} transaction`,
        `amount: ${fmt(i.amount)}`,
        `date: ${i.date}`,
        `category: ${category}`,
        `store: ${fmt(i.store)}`,
        `note: ${fmt(i.note)}`,
        ...(receipt
          ? [`receipt: ${receipt.scan.products.length} products, total ${fmt(receipt.scan.total)}`]
          : []),
        ...(products
          ? [`products: ${products.map((p) => `${p.name} ${fmt(p.cost)}`).join(", ")} (costs sum to ${fmt(costSum(products))})`]
          : []),
      ].join("\n");
    },
    run: async (userId, { new_category: _new, receipt_id, products: items, ...i }) => {
      if (receipt_id && items) throw new AgentToolError("Pass products or receipt_id, not both");
      const products = items ? parseProducts(items) : null;
      // Re-resolve at accept time: use the stored spelling of an existing category.
      if (i.category_name?.trim()) {
        const { category } = await resolveCategoryName(userId, i.category_name);
        if (category) i.category_name = category.name;
      }
      const receipt = receipt_id ? await requireScannedAttachment(userId, receipt_id) : null;
      // has_receipt lets a receipt stand in for a missing amount/category, as on
      // the create form; the row starts 'processing' until the recompute below.
      const fd = toFormData({ ...i, ...(receipt && { has_receipt: "1" }) });
      const r = unwrap(await createTransactionFor(userId, fd));
      if (!r.ok) return { transaction_id: null };
      if (products) {
        try {
          await insertProducts(userId, r.id, products);
        } finally {
          await recomputeTransactionStatus(userId, r.id);
        }
      }
      if (!receipt) return { transaction_id: r.id };
      try {
        await upsertReceipt(
          userId,
          r.id,
          { bytes: receipt.image, contentType: receipt.content_type },
          receipt.scan.total,
        );
        await insertProducts(userId, r.id, receipt.scan.products);
      } finally {
        // Never leave the row on 'processing'.
        await recomputeTransactionStatus(userId, r.id);
      }
      return { transaction_id: r.id };
    },
  }),
  tool({
    name: "apply_receipt_scan",
    description:
      "Propose replacing a transaction's product line items with the ones from the latest scan of its stored receipt. Call scan_receipt with that transaction_id first.",
    input: z.object({ transaction_id: ID }),
    requiresApproval: true,
    describe: async (userId, i) => {
      const tx = await requireTransaction(userId, i.transaction_id);
      const { scan } = await requireScannedReceipt(userId, i.transaction_id);
      const sum = costSum(scan.products);
      return [
        `Apply the scanned receipt to transaction ${txLabel(tx)}`,
        `products: ${tx.products?.length ?? 0} → ${scan.products.length} (costs sum to ${fmt(sum)})`,
        `scanned total: ${fmt(tx.scanned_total)} → ${fmt(scan.total)}`,
        ...(tx.category_id === null && scan.category ? [`category: — → ${scan.category}`] : []),
        ...(tx.store === null && scan.store ? [`store: — → ${scan.store}`] : []),
      ].join("\n");
    },
    run: async (userId, i) => {
      // Re-read the cached scan: scan_receipt may have refreshed it since.
      const { scan } = await requireScannedReceipt(userId, i.transaction_id);
      return applyScan(userId, i.transaction_id, scan);
    },
  }),
  tool({
    name: "replace_receipt_photo",
    description:
      "Propose filing a receipt photo attached in this chat onto an existing transaction: it replaces the transaction's stored photo and its product line items. Call scan_receipt with that receipt_id first.",
    input: z.object({ transaction_id: ID, receipt_id: ID }),
    requiresApproval: true,
    describe: async (userId, i) => {
      const tx = await requireTransaction(userId, i.transaction_id);
      const { scan } = await requireScannedAttachment(userId, i.receipt_id);
      return [
        `Replace the receipt photo of transaction ${txLabel(tx)}`,
        `products: ${tx.products?.length ?? 0} → ${scan.products.length}`,
        `scanned total: ${fmt(tx.scanned_total)} → ${fmt(scan.total)}`,
      ].join("\n");
    },
    run: async (userId, i) => {
      const attachment = await requireScannedAttachment(userId, i.receipt_id);
      await requireTransaction(userId, i.transaction_id);
      await upsertReceipt(
        userId,
        i.transaction_id,
        { bytes: attachment.image, contentType: attachment.content_type },
        attachment.scan.total,
        attachment.scan,
      );
      return applyScan(userId, i.transaction_id, attachment.scan);
    },
  }),
  tool({
    name: "update_transactions",
    description:
      "Propose changing one or more transactions in a single approval (e.g. recategorize many at once). Only the fields you pass change, the same way on every listed transaction.",
    input: updateTransactionsInput,
    requiresApproval: true,
    describe: async (userId, { ids, ...i }) => {
      const txs = await requireTransactions(userId, ids);
      const { shown } = await transactionPatch(userId, i);
      const changed = txs
        .map((tx) => ({ tx, lines: diffLines(shownFields(tx), shown) }))
        .filter((c) => c.lines.length > 0);
      if (changed.length === 0) throw new AgentToolError("Nothing would change");
      if (txs.length === 1) return [`Update transaction ${txLabel(txs[0])}`, ...changed[0].lines].join("\n");
      const values = Object.entries(shown)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k} → ${fmt(v)}`)
        .join(", ");
      const unchanged = txs.length - changed.length;
      return [
        `Update ${changed.length} transactions: ${values}`,
        ...changed.slice(0, SUMMARY_ROWS).map((c) => txLabel(c.tx)),
        ...(changed.length > SUMMARY_ROWS ? [`…and ${changed.length - SUMMARY_ROWS} more`] : []),
        ...(unchanged > 0 ? [`(${unchanged} already match)`] : []),
      ].join("\n");
    },
    run: async (userId, { ids, ...i }) => {
      // Merge onto the rows as they are *now* (they may have changed since proposal).
      const txs = await requireTransactions(userId, ids);
      const { patch } = await transactionPatch(userId, i);
      for (const [n, tx] of txs.entries()) {
        const merged = {
          id: tx.id,
          type: tx.type,
          amount: tx.amount,
          date: tx.date,
          note: tx.note,
          store: tx.store,
          category_id: tx.category_id,
          ...patch,
        };
        const r = await updateTransactionFor(userId, toFormData(merged));
        if (!r.ok)
          throw new AgentToolError(
            n === 0 ? (r.error ?? "Failed") : `#${tx.id}: ${r.error ?? "Failed"} (${n} of ${txs.length} already updated)`,
          );
      }
      return { updated_transaction_ids: txs.map((tx) => tx.id) };
    },
  }),
  tool({
    name: "delete_transaction",
    description: "Propose deleting a transaction together with its products and receipt.",
    input: idInput,
    requiresApproval: true,
    describe: async (userId, i) => `Delete transaction ${txLabel(await requireTransaction(userId, i.id))}`,
    run: async (userId, i) => {
      unwrap(await deleteTransactionFor(userId, toFormData(i)));
      return { deleted_transaction_id: i.id };
    },
  }),
  tool({
    name: "add_product",
    description: "Propose adding a product line item to a transaction.",
    input: addProductInput,
    requiresApproval: true,
    describe: async (userId, { transaction_id, ...p }) => {
      const tx = await requireTransaction(userId, transaction_id);
      const details = Object.entries(p)
        .filter(([k, v]) => k !== "name" && v != null && fmt(v) !== "—")
        .map(([k, v]) => `${k}: ${fmt(v)}`);
      return [`Add product "${p.name}" to transaction ${txLabel(tx)}`, ...details].join("\n");
    },
    run: async (userId, i) => {
      unwrap(await addProductFor(userId, toFormData(i)));
      return { transaction_id: i.transaction_id };
    },
  }),
  tool({
    name: "update_product",
    description: "Propose changing fields of a product line item. Only the fields you pass change.",
    input: updateProductInput,
    requiresApproval: true,
    describe: async (userId, { id, ...patch }) => {
      const product = await getProduct(userId, id);
      if (!product) throw new AgentToolError(`Product ${id} not found`);
      const lines = diffLines(product, patch);
      if (lines.length === 0) throw new AgentToolError("Nothing would change");
      return [`Update product #${id} "${product.name}"`, ...lines].join("\n");
    },
    run: async (userId, { id, ...patch }) => {
      const product = await getProduct(userId, id);
      if (!product) throw new AgentToolError(`Product ${id} not found`);
      const merged = {
        ...product,
        id,
        ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
      };
      unwrap(await updateProductFor(userId, toFormData(merged)));
      return { product_id: id };
    },
  }),
  tool({
    name: "delete_product",
    description: "Propose deleting a product line item.",
    input: idInput,
    requiresApproval: true,
    describe: async (userId, i) => {
      const product = await getProduct(userId, i.id);
      if (!product) throw new AgentToolError(`Product ${i.id} not found`);
      return `Delete product #${product.id} "${product.name}" (cost ${fmt(product.cost)}) from transaction #${product.transaction_id}`;
    },
    run: async (userId, i) => {
      if (!(await getProduct(userId, i.id))) throw new AgentToolError(`Product ${i.id} not found`);
      unwrap(await deleteProductFor(userId, toFormData(i)));
      return { deleted_product_id: i.id };
    },
  }),
  tool({
    name: "create_category",
    description: "Propose a new category.",
    input: createCategoryInput,
    requiresApproval: true,
    describe: async (_userId, i) => `Create category "${i.name}" (priority ${i.priority ?? 5})`,
    run: async (userId, i) => {
      unwrap(await createCategoryFor(userId, toFormData(i)));
      return { created_category: i.name };
    },
  }),
  tool({
    name: "update_category",
    description: "Propose renaming a category or changing its priority.",
    input: updateCategoryInput,
    requiresApproval: true,
    describe: async (userId, { id, ...patch }) => {
      const category = await getCategory(userId, id);
      if (!category) throw new AgentToolError(`Category ${id} not found`);
      const lines = diffLines(category, patch);
      if (lines.length === 0) throw new AgentToolError("Nothing would change");
      return [`Update category "${category.name}"`, ...lines].join("\n");
    },
    run: async (userId, { id, ...patch }) => {
      const category = await getCategory(userId, id);
      if (!category) throw new AgentToolError(`Category ${id} not found`);
      unwrap(
        await updateCategoryFor(
          userId,
          toFormData({
            id,
            name: patch.name ?? category.name,
            priority: patch.priority ?? category.priority,
          }),
        ),
      );
      return { category_id: id };
    },
  }),
  tool({
    name: "set_plans",
    description:
      "Propose the planned spend for one or more categories in a month, in a single approval (replaces those categories' existing plans; others are untouched).",
    input: setPlansInput,
    requiresApproval: true,
    describe: async (userId, i) => {
      const plans = await resolvePlans(userId, i.plans);
      const current = new Map(
        (await getPlansForMonth(userId, i.month, plans.map((p) => p.category.id))).map((r) => [r.category_id, r.amount]),
      );
      const lines = plans
        .filter((p) => fmt(current.get(p.category.id)) !== fmt(p.amount))
        .map((p) => `${p.category.name}: ${fmt(current.get(p.category.id))} → ${p.amount}`);
      if (lines.length === 0) throw new AgentToolError("Nothing would change");
      return [`Set ${i.month} plans`, ...lines].join("\n");
    },
    run: async (userId, i) => {
      const plans = await resolvePlans(userId, i.plans);
      for (const p of plans)
        unwrap(await upsertPlanFor(userId, toFormData({ category_id: p.category.id, month: i.month, amount: p.amount })));
      return { month: i.month, plans: plans.length };
    },
  }),
];

const BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

export function getAgentTool(name: string): AgentTool | undefined {
  return BY_NAME.get(name);
}

/** Validate raw tool input. Throws AgentToolError with a readable message. */
export function parseToolInput(tool: AgentTool, raw: unknown): Record<string, unknown> {
  const parsed = tool.input.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new AgentToolError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "),
    );
  }
  return parsed.data as Record<string, unknown>;
}
