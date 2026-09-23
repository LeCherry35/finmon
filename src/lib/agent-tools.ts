import "server-only";
import { z } from "zod";
import { pool } from "@/db";
import {
  getAvailableMonths,
  getCategories,
  getCategory,
  getExpendituresByCategory,
  getPlansForMonth,
  getProduct,
  getTransaction,
  getTransactions,
} from "@/db/queries";
import {
  createTransactionFor,
  deleteTransactionFor,
  updateTransactionFor,
  verifyTransactionFor,
} from "@/lib/mutations/transactions";
import {
  addProductFor,
  deleteProductFor,
  insertProducts,
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

function txLabel(t: Pick<Transaction, "id" | "type" | "amount" | "date" | "store" | "category_name">) {
  return `#${t.id} ${t.type} ${fmt(t.amount)} on ${t.date}${t.store ? ` at ${t.store}` : ""}${
    t.category_name ? ` (${t.category_name})` : ""
  }`;
}

/** The user's categories plus the one matching `name` (trimmed,
 *  case-insensitive), so "food" reuses an existing "Food". */
async function resolveCategoryName(userId: string, name: string) {
  const all = await getCategories(userId);
  const key = name.trim().toLocaleLowerCase();
  const category =
    all.find((c) => c.name === name.trim()) ?? all.find((c) => c.name.toLocaleLowerCase() === key) ?? null;
  return { category, all };
}

/** "3: Groceries, 5: Transport" — handed to the model when it names a category
 *  that doesn't exist. */
function categoryListText(all: { id: number; name: string }[]): string {
  return all.length ? all.map((c) => `${c.id}: ${c.name}`).join(", ") : "none yet";
}

/** Keep search results compact for the model's context. */
function compactTransaction(t: Transaction) {
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
    status: t.status,
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
    product_cost_sum: round2(scan.products.reduce((sum, p) => sum + (p.cost ?? 0), 0)),
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

// ---------------------------------------------------------------------------
// Input schemas

const searchTransactionsInput = z.object({
  months: z.array(MONTH).optional().describe("Only these months (YYYY-MM). Omit for all time."),
  category_ids: z.array(ID).optional().describe("Only these category ids."),
  query: z.string().max(100).optional().describe("Free text matched against store, note, category and product names/brands/tags."),
  sort: z.enum(["date", "added"]).optional().describe("date (default) = by transaction date, added = newest entries first."),
  limit: num(z.number().int().min(1).max(200)).optional().describe("Max rows returned (default 50)."),
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
});

const updateTransactionInput = z.object({
  id: ID,
  type: transactionFields.type.optional(),
  amount: transactionFields.amount,
  date: DATE.optional(),
  note: transactionFields.note,
  store: transactionFields.store,
  category_id: ID.nullable().optional().describe("Existing category id. null makes it uncategorized."),
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

const upsertPlanInput = z.object({
  category_id: ID,
  month: MONTH,
  amount: num(z.number().min(0)).describe("Planned spend for the month; 0 is allowed."),
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
      "Find transactions, newest first, with their product line items. Amount may be null when only a scanned receipt total exists (see scanned_total).",
    input: searchTransactionsInput,
    requiresApproval: false,
    run: async (userId, i) => {
      const rows = await getTransactions(
        userId,
        { months: i.months, categoryIds: i.category_ids ?? null },
        i.sort ?? "date",
        i.query,
      );
      const limit = i.limit ?? 50;
      return {
        total_matches: rows.length,
        returned: Math.min(limit, rows.length),
        transactions: rows.slice(0, limit).map(compactTransaction),
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
      const { receipt_id, ...tx } = await requireTransaction(userId, i.id);
      return { ...tx, has_receipt: receipt_id !== null };
    },
  }),
  tool({
    name: "spend_by_category",
    description: "Total spend and transaction count per category (Uncategorized = id 0), largest first.",
    input: z.object({ months: z.array(MONTH).optional().describe("Omit for all time.") }),
    requiresApproval: false,
    run: (userId, i) => getExpendituresByCategory(userId, { months: i.months }),
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
      ].join("\n");
    },
    run: async (userId, { new_category: _new, receipt_id, ...i }) => {
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
      if (!r.ok || !receipt) return { transaction_id: r.ok ? r.id : null };
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
      const sum = round2(scan.products.reduce((total, p) => total + (p.cost ?? 0), 0));
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
    name: "update_transaction",
    description: "Propose changing fields of a transaction. Only the fields you pass change.",
    input: updateTransactionInput,
    requiresApproval: true,
    describe: async (userId, { id, ...patch }) => {
      const tx = await requireTransaction(userId, id);
      if (patch.category_id != null && !(await getCategory(userId, patch.category_id)))
        throw new AgentToolError(
          `Category ${patch.category_id} not found. Existing categories: ${categoryListText(await getCategories(userId))}`,
        );
      const lines = diffLines(tx, patch);
      if (lines.length === 0) throw new AgentToolError("Nothing would change");
      return [`Update transaction ${txLabel(tx)}`, ...lines].join("\n");
    },
    run: async (userId, { id, ...patch }) => {
      // Merge onto the row as it is *now* (it may have changed since proposal).
      const tx = await requireTransaction(userId, id);
      const merged = {
        id,
        type: tx.type,
        amount: tx.amount,
        date: tx.date,
        note: tx.note,
        store: tx.store,
        category_id: tx.category_id,
        ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
      };
      unwrap(await updateTransactionFor(userId, toFormData(merged)));
      return { transaction_id: id };
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
    name: "verify_transaction",
    description: "Propose marking a ready_to_verify transaction (product costs match its amount) as verified.",
    input: idInput,
    requiresApproval: true,
    describe: async (userId, i) => {
      const tx = await requireTransaction(userId, i.id);
      if (tx.status !== "ready_to_verify")
        throw new AgentToolError(`Transaction is ${tx.status}, not ready_to_verify`);
      return `Verify transaction ${txLabel(tx)}`;
    },
    run: async (userId, i) => {
      unwrap(await verifyTransactionFor(userId, toFormData(i)));
      return { verified_transaction_id: i.id };
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
    name: "set_plan",
    description: "Propose setting the planned spend for a category in a month (replaces any existing plan).",
    input: upsertPlanInput,
    requiresApproval: true,
    describe: async (userId, i) => {
      const category = await getCategory(userId, i.category_id);
      if (!category) throw new AgentToolError(`Category ${i.category_id} not found`);
      const current = (await getPlansForMonth(userId, i.month, [i.category_id]))[0]?.amount ?? null;
      return `Set ${i.month} plan for "${category.name}": ${fmt(current)} → ${i.amount}`;
    },
    run: async (userId, i) => {
      unwrap(await upsertPlanFor(userId, toFormData(i)));
      return { category_id: i.category_id, month: i.month };
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
