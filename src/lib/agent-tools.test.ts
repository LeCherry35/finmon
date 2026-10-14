import { beforeEach, describe, expect, it, vi } from "vitest";

const q = vi.hoisted(() => ({
  getAvailableMonths: vi.fn(),
  getCategories: vi.fn(),
  getCategory: vi.fn(),
  summarizeTransactions: vi.fn(),
  getPlansForMonth: vi.fn(),
  getProduct: vi.fn(),
  getTransaction: vi.fn(),
  getTransactions: vi.fn(),
}));
const m = vi.hoisted(() => ({
  createTransactionFor: vi.fn(),
  updateTransactionFor: vi.fn(),
  deleteTransactionsFor: vi.fn(),
  addProductFor: vi.fn(),
  updateProductFor: vi.fn(),
  deleteProductFor: vi.fn(),
  createCategoryFor: vi.fn(),
  updateCategoryFor: vi.fn(),
  upsertPlanFor: vi.fn(),
  insertProducts: vi.fn(),
  parseProductFields: vi.fn(),
  recomputeTransactionStatus: vi.fn(),
}));
const { query, scanReceipt, upsertReceipt, getStoredReceipt, saveReceiptScan, setReceiptTotal, applyScanToTransaction, deleteTransactionProducts } =
  vi.hoisted(() => ({
    query: vi.fn(),
    setReceiptTotal: vi.fn(),
    scanReceipt: vi.fn(),
    upsertReceipt: vi.fn(),
    getStoredReceipt: vi.fn(),
    saveReceiptScan: vi.fn(),
    applyScanToTransaction: vi.fn(),
    deleteTransactionProducts: vi.fn(),
  }));

vi.mock("@/db/queries", () => q);
vi.mock("@/lib/mutations/transactions", () => m);
vi.mock("@/lib/mutations/products", () => m);
vi.mock("@/lib/mutations/categories", () => m);
vi.mock("@/lib/mutations/plans", () => m);
vi.mock("@/db", () => ({ pool: { query } }));
vi.mock("@/lib/receipt-scan", () => ({ scanReceipt }));
const cur = vi.hoisted(() => {
  class CurrencyError extends Error {}
  return { CurrencyError, getRate: vi.fn(), convert: vi.fn(), convertScanToBase: vi.fn() };
});
vi.mock("@/lib/currency", () => cur);
vi.mock("@/lib/receipts", () => ({
  upsertReceipt,
  getStoredReceipt,
  saveReceiptScan,
  setReceiptTotal,
  applyScanToTransaction,
  deleteTransactionProducts,
}));

import { AGENT_TOOLS, AgentToolError, getAgentTool, parseToolInput } from "@/lib/agent-tools";

const tool = (name: string) => getAgentTool(name)!;
const run = (name: string, userId: string, input: unknown) =>
  tool(name).run(userId, parseToolInput(tool(name), input) as never);
const describeCall = (name: string, userId: string, input: unknown) =>
  tool(name).describe!(userId, parseToolInput(tool(name), input) as never);
const fields = (fd: FormData) => Object.fromEntries(fd.entries());

const tx = {
  id: 9,
  type: "spend",
  amount: 10,
  currency: "UAH",
  original_amount: null,
  exchange_rate: null,
  date: "2026-09-01",
  note: null,
  store: "Shop",
  category_id: 3,
  category_name: "Food",
  status: "unverified",
  products: [],
};

beforeEach(() => {
  for (const fn of [
    ...Object.values(q),
    ...Object.values(m),
    query,
    scanReceipt,
    upsertReceipt,
    getStoredReceipt,
    saveReceiptScan,
    applyScanToTransaction,
    deleteTransactionProducts,
    setReceiptTotal,
    cur.getRate,
    cur.convert,
    cur.convertScanToBase,
  ])
    fn.mockReset();
});

describe("registry", () => {
  it("requires approval for every tool that can change data, and only those", () => {
    const approval = AGENT_TOOLS.filter((t) => t.requiresApproval).map((t) => t.name).sort();
    expect(approval).toEqual(
      [
        "add_product",
        "apply_receipt_scan",
        "create_category",
        "create_transaction",
        "delete_product",
        "delete_transactions",
        "replace_receipt_photo",
        "set_plans",
        "update_category",
        "update_product",
        "update_transactions",
      ].sort(),
    );
    for (const t of AGENT_TOOLS.filter((t) => t.requiresApproval)) expect(t.describe).toBeDefined();
  });

  it("rejects invalid input with a readable message", () => {
    expect(() => parseToolInput(tool("get_plans"), { month: "Sept" })).toThrow(AgentToolError);
    expect(() => parseToolInput(tool("get_plans"), { month: "Sept" })).toThrow(/month: Use YYYY-MM/);
  });

  it("accepts numbers sent as numeric strings, but not other strings", () => {
    const input = { type: "spend", date: "2026-09-17" };
    expect(parseToolInput(tool("create_transaction"), { ...input, amount: "100" }).amount).toBe(100);
    expect(parseToolInput(tool("get_transaction"), { id: "7" }).id).toBe(7);
    expect(() => parseToolInput(tool("create_transaction"), { ...input, amount: "100 грн" })).toThrow(
      /amount: .*expected number/,
    );
  });
});

describe("read tools", () => {
  it("scope every query to the caller's user id", async () => {
    q.getCategories.mockResolvedValue([{ id: 1, name: "Food", priority: 5, user_id: "user-1" }]);
    expect(await run("list_categories", "user-1", {})).toEqual([{ id: 1, name: "Food", priority: 5 }]);
    expect(q.getCategories).toHaveBeenCalledWith("user-1");

    q.getTransactions.mockResolvedValue([tx, { ...tx, id: 10 }]);
    const found = (await run("search_transactions", "user-1", {
      months: ["2026-09"],
      query: "shop",
      limit: 1,
    })) as { total_matches: number; transactions: unknown[] };
    expect(q.getTransactions).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ months: ["2026-09"], categoryIds: null }),
      "date",
      ["shop"],
    );
    expect(found.total_matches).toBe(2);
    expect(found.transactions).toHaveLength(1);

    q.getPlansForMonth.mockResolvedValue([]);
    await run("get_plans", "user-1", { month: "2026-09" });
    expect(q.getPlansForMonth).toHaveBeenCalledWith("user-1", "2026-09");
  });

  it("search_transactions passes every filter, pages, and leaves out status and line items", async () => {
    const product = { id: 1, name: "Milk", cost: 2 };
    q.getTransactions.mockResolvedValue([1, 2, 3].map((id) => ({ ...tx, id, products: [product] })));

    const out = (await run("search_transactions", "user-1", {
      date_from: "2026-09-01",
      date_to: "2026-09-30",
      type: "spend",
      uncategorized: true,
      amount_min: "5",
      amount_max: 50,
      query: ["fuel", "Shell"],
      sort: "amount",
      limit: 1,
      offset: 1,
    })) as { total_matches: number; returned: number; transactions: Record<string, unknown>[] };

    expect(q.getTransactions).toHaveBeenCalledWith(
      "user-1",
      {
        months: undefined,
        categoryIds: null,
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
        type: "spend",
        uncategorized: true,
        amountMin: 5,
        amountMax: 50,
      },
      "amount",
      ["fuel", "Shell"],
    );
    expect(out).toMatchObject({ total_matches: 3, returned: 1 });
    expect(out.transactions[0]).toMatchObject({ id: 2, product_count: 1 });
    expect(out.transactions[0]).not.toHaveProperty("status");
    expect(out.transactions[0]).not.toHaveProperty("products");

    const withProducts = (await run("search_transactions", "user-1", { include_products: true })) as {
      transactions: Record<string, unknown>[];
    };
    expect(withProducts.transactions[0].products).toEqual([product]);
  });

  it("summarize_transactions defaults to spend, rounds, totals and caps the groups", async () => {
    const rows = Array.from({ length: 101 }, (_, n) => ({ key: n, label: `C${n}`, total: n === 0 ? 1.234 : 1.25, count: 2 }));
    q.summarizeTransactions.mockResolvedValue(rows);

    const out = (await run("summarize_transactions", "user-1", { group_by: "category", query: "fuel" })) as {
      total: number;
      count: number;
      groups_total: number;
      groups: unknown[];
    };

    expect(q.summarizeTransactions).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ type: "spend" }),
      ["fuel"],
      "category",
      "transactions",
    );
    expect(out).toMatchObject({ count: 202, groups_total: 101 });
    expect(out.total).toBe(126.23);
    expect(out.groups[0]).toMatchObject({ total: 1.23 });
    expect(out.groups).toHaveLength(100);
  });

  it("summarize_transactions keeps both types when grouping by type, and checks group_by product", async () => {
    q.summarizeTransactions.mockResolvedValue([]);
    await run("summarize_transactions", "user-1", { group_by: "type" });
    expect(q.summarizeTransactions.mock.calls[0][1].type).toBeUndefined();

    await expect(run("summarize_transactions", "user-1", { group_by: "product" })).rejects.toThrow(
      'group_by "product" needs of: "products"',
    );
    await run("summarize_transactions", "user-1", { group_by: "product", of: "products" });
    expect(q.summarizeTransactions).toHaveBeenLastCalledWith(
      "user-1",
      expect.anything(),
      undefined,
      "product",
      "products",
    );
  });

  it("get_transaction reports the receipt as a flag, not a receipts id, and no status", async () => {
    q.getTransaction.mockResolvedValue({ ...tx, receipt_id: 7, user_id: "user-1" });

    const out = (await run("get_transaction", "user-1", { id: 9 })) as Record<string, unknown>;

    // receipts.id and scan_receipt's receipt_id (a chat attachment) are
    // different id spaces — handing one over invites the wrong call.
    expect(out).not.toHaveProperty("receipt_id");
    expect(out.has_receipt).toBe(true);
    expect(out).not.toHaveProperty("status");
    expect(out).not.toHaveProperty("user_id");
  });

  it("get_transaction reports a missing/foreign id as a tool error", async () => {
    q.getTransaction.mockResolvedValue(null);
    await expect(run("get_transaction", "user-1", { id: 9 })).rejects.toThrow("Transaction 9 not found");
    expect(q.getTransaction).toHaveBeenCalledWith("user-1", 9);
  });
});

describe("write tools", () => {
  it("update_transactions describes only the fields that change on a single transaction", async () => {
    q.getTransaction.mockResolvedValue(tx);
    const summary = await describeCall("update_transactions", "user-1", { ids: [9], amount: 12.5, store: "Shop" });
    expect(summary).toBe("Update transaction #9 spend 10 on 2026-09-01 at Shop (Food)\namount: 10 → 12.5");
  });

  it("create_transaction shows a USD amount with its UAH equivalent and passes the currency on", async () => {
    cur.getRate.mockResolvedValue({ rate: 41.52, date: "2026-09-01" });
    q.getCategories.mockResolvedValue([{ id: 3, name: "Food", priority: 5 }]);
    const input = { type: "spend", amount: 25, currency: "USD", date: "2026-09-01", category_name: "Food" };

    const summary = await describeCall("create_transaction", "user-1", input);
    expect(summary).toContain("amount: 25 USD ≈ 1038.00 UAH (NBU 41.52 on 2026-09-01)");
    expect(cur.getRate).toHaveBeenCalledWith("USD", "2026-09-01");

    m.createTransactionFor.mockResolvedValue({ ok: true, id: 12 });
    await run("create_transaction", "user-1", input);
    expect(fields(m.createTransactionFor.mock.calls[0][1])).toMatchObject({ amount: "25", currency: "USD" });
  });

  it("update_transactions re-saves a USD row as entered, and needs an amount with a currency", async () => {
    const usdTx = { ...tx, amount: 1038, currency: "USD", original_amount: 25, exchange_rate: 41.52 };
    q.getTransaction.mockResolvedValue(usdTx);
    q.getCategories.mockResolvedValue([]);
    m.updateTransactionFor.mockResolvedValue({ ok: true });

    await run("update_transactions", "user-1", { ids: [9], note: "x" });
    expect(fields(m.updateTransactionFor.mock.calls[0][1])).toMatchObject({ amount: "25", currency: "USD", note: "x" });

    await expect(describeCall("update_transactions", "user-1", { ids: [9], currency: "EUR" })).rejects.toThrow(
      "pass the amount with it",
    );
  });

  it("update_transactions refuses a no-op, an unknown category or a missing transaction", async () => {
    q.getTransaction.mockResolvedValue(tx);
    await expect(describeCall("update_transactions", "user-1", { ids: [9], amount: 10 })).rejects.toThrow(
      "Nothing would change",
    );
    q.getCategories.mockResolvedValue([{ id: 3, name: "Food", priority: 5 }]);
    await expect(
      describeCall("update_transactions", "user-1", { ids: [9], category_name: "Groceries" }),
    ).rejects.toThrow('Category "Groceries" doesn\'t exist. Existing categories: 3: Food');

    q.getTransaction.mockImplementation(async (_u: string, id: number) => (id === 9 ? tx : null));
    await expect(
      describeCall("update_transactions", "user-1", { ids: [9, 11, 12], note: "x" }),
    ).rejects.toThrow("Transactions not found: 11, 12");
  });

  it("update_transactions summarizes a bulk change by category name, skipping rows that match", async () => {
    q.getTransaction.mockImplementation(async (_u: string, id: number) =>
      id === 1 ? { ...tx, id, category_id: 4, category_name: "Groceries" } : { ...tx, id },
    );
    q.getCategories.mockResolvedValue([
      { id: 3, name: "Food", priority: 5 },
      { id: 4, name: "Groceries", priority: 5 },
    ]);
    const ids = Array.from({ length: 13 }, (_, n) => n + 1);

    const summary = await describeCall("update_transactions", "user-1", { ids, category_name: "groceries" });

    const lines = summary.split("\n");
    expect(lines[0]).toBe("Update 12 transactions: category → Groceries");
    expect(lines[1]).toBe("#2 spend 10 on 2026-09-01 at Shop (Food)");
    expect(lines).toHaveLength(1 + 10 + 2);
    expect(lines.at(-2)).toBe("…and 2 more");
    expect(lines.at(-1)).toBe("(1 already match)");
  });

  it("update_transactions merges the patch onto each current row when applied", async () => {
    q.getTransaction.mockImplementation(async (_u: string, id: number) => ({ ...tx, id }));
    q.getCategories.mockResolvedValue([]);
    m.updateTransactionFor.mockResolvedValue({ ok: true });

    expect(await run("update_transactions", "user-1", { ids: [9, 10, 9], amount: 12.5, note: null, category_name: null })).toEqual({
      updated_transaction_ids: [9, 10],
    });

    expect(m.updateTransactionFor).toHaveBeenCalledTimes(2);
    const [userId, fd] = m.updateTransactionFor.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(fields(fd)).toEqual({
      id: "9",
      type: "spend",
      amount: "12.5",
      currency: "UAH",
      date: "2026-09-01",
      note: "",
      store: "Shop",
      category_id: "",
    });
    expect(fields(m.updateTransactionFor.mock.calls[1][1]).id).toBe("10");
  });

  it("update_transactions writes nothing when a listed transaction is gone, and reports a partial failure", async () => {
    q.getTransaction.mockImplementation(async (_u: string, id: number) => (id === 9 ? tx : null));
    await expect(run("update_transactions", "user-1", { ids: [9, 10], note: "x" })).rejects.toThrow(
      "Transactions not found: 10",
    );
    expect(m.updateTransactionFor).not.toHaveBeenCalled();

    q.getTransaction.mockImplementation(async (_u: string, id: number) => ({ ...tx, id }));
    m.updateTransactionFor.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: "Bad date" });
    await expect(run("update_transactions", "user-1", { ids: [9, 10], note: "x" })).rejects.toThrow(
      "#10: Bad date (1 of 2 already updated)",
    );
  });

  it("delete_transactions describes one row like before, many as a totals headline", async () => {
    q.getTransaction.mockResolvedValue(tx);
    expect(await describeCall("delete_transactions", "user-1", { ids: [9] })).toBe(
      "Delete transaction #9 spend 10 on 2026-09-01 at Shop (Food)",
    );

    q.getTransaction.mockImplementation(async (_u: string, id: number) => ({
      ...tx,
      id,
      date: `2026-09-${String(id).padStart(2, "0")}`,
      ...(id === 1 ? { amount: null, scanned_total: 2.5 } : {}),
      ...(id === 2 ? { type: "income", amount: 100 } : {}),
    }));
    const lines = (await describeCall("delete_transactions", "user-1", { ids: [...Array(12)].map((_, n) => n + 1) })).split("\n");
    expect(lines[0]).toBe("Delete 12 transactions: spend 102.5, income 100, 2026-09-01 – 2026-09-12");
    expect(lines).toHaveLength(1 + 10 + 1);
    expect(lines.at(-1)).toBe("…and 2 more");
  });

  it("delete_transactions refuses missing rows up front, tolerates rows gone by Accept", async () => {
    q.getTransaction.mockImplementation(async (_u: string, id: number) => (id === 9 ? tx : null));
    await expect(describeCall("delete_transactions", "user-1", { ids: [9, 10] })).rejects.toThrow(
      "Transactions not found: 10",
    );

    m.deleteTransactionsFor.mockResolvedValueOnce([9]);
    expect(await run("delete_transactions", "user-1", { ids: [9, 10, 9] })).toEqual({ deleted_transaction_ids: [9] });
    expect(m.deleteTransactionsFor).toHaveBeenCalledWith("user-1", [9, 10]);

    m.deleteTransactionsFor.mockResolvedValueOnce([]);
    await expect(run("delete_transactions", "user-1", { ids: [9] })).rejects.toThrow("Already deleted");
  });

  it("surfaces a mutation's validation error so the proposal fails", async () => {
    m.createTransactionFor.mockResolvedValue({ ok: false, error: "Date must be YYYY-MM-DD" });
    await expect(
      run("create_transaction", "user-1", { type: "spend", amount: 5, date: "2026-09-17" }),
    ).rejects.toThrow("Date must be YYYY-MM-DD");
  });

  it("create_transaction needs an amount or a category", async () => {
    await expect(
      describeCall("create_transaction", "user-1", { type: "spend", date: "2026-09-17" }),
    ).rejects.toThrow("Add an amount or a category");
  });

  it("create_transaction reuses an existing category regardless of case", async () => {
    q.getCategories.mockResolvedValue([{ id: 3, name: "Food", priority: 5 }]);
    const input = { type: "spend", amount: 5, date: "2026-09-17", category_name: "food" };
    expect(await describeCall("create_transaction", "user-1", input)).toContain("category: Food\n");
    m.createTransactionFor.mockResolvedValue({ ok: true, id: 11 });
    await run("create_transaction", "user-1", input);
    expect(fields(m.createTransactionFor.mock.calls[0][1]).category_name).toBe("Food");
    expect(q.getCategories).toHaveBeenCalledWith("user-1");
  });

  it("create_transaction returns the existing categories for an unknown name", async () => {
    q.getCategories.mockResolvedValue([
      { id: 3, name: "Food", priority: 5 },
      { id: 4, name: "Transport", priority: 5 },
    ]);
    const input = { type: "spend", amount: 5, date: "2026-09-17", category_name: "Groceries" };
    await expect(describeCall("create_transaction", "user-1", input)).rejects.toThrow(
      /doesn't exist\. Existing categories: 3: Food, 4: Transport/,
    );
    expect(
      await describeCall("create_transaction", "user-1", { ...input, new_category: true }),
    ).toContain("category: Groceries (NEW category)");
    m.createTransactionFor.mockResolvedValue({ ok: true, id: 11 });
    await run("create_transaction", "user-1", { ...input, new_category: true });
    expect(fields(m.createTransactionFor.mock.calls[0][1])).not.toHaveProperty("new_category");
  });

  it("delete_product checks the product belongs to the user before and when applying", async () => {
    q.getProduct.mockResolvedValue(null);
    await expect(describeCall("delete_product", "user-1", { id: 4 })).rejects.toThrow("Product 4 not found");
    await expect(run("delete_product", "user-1", { id: 4 })).rejects.toThrow("Product 4 not found");
    expect(m.deleteProductFor).not.toHaveBeenCalled();
    expect(q.getProduct).toHaveBeenCalledWith("user-1", 4);
  });

  const categories = [
    { id: 3, name: "Food", priority: 5 },
    { id: 4, name: "Transport", priority: 5 },
  ];

  it("set_plans shows each changed plan, skipping unchanged ones", async () => {
    q.getCategories.mockResolvedValue(categories);
    q.getPlansForMonth.mockResolvedValue([
      { category_id: 3, amount: 200 },
      { category_id: 4, amount: 50 },
    ]);
    const input = {
      month: "2026-10",
      plans: [
        { category_name: "food", amount: 250 },
        { category_name: "Transport", amount: 50 },
      ],
    };
    expect(await describeCall("set_plans", "user-1", input)).toBe("Set 2026-10 plans\nFood: 200 → 250");
    expect(q.getPlansForMonth).toHaveBeenCalledWith("user-1", "2026-10", [3, 4]);

    q.getPlansForMonth.mockResolvedValue([{ category_id: 3, amount: 250 }]);
    await expect(
      describeCall("set_plans", "user-1", { month: "2026-10", plans: [{ category_name: "Food", amount: 250 }] }),
    ).rejects.toThrow("Nothing would change");
  });

  it("set_plans refuses unknown or repeated categories", async () => {
    q.getCategories.mockResolvedValue(categories);
    await expect(
      describeCall("set_plans", "user-1", { month: "2026-10", plans: [{ category_name: "Pets", amount: 1 }] }),
    ).rejects.toThrow('Unknown categories: "Pets". Existing categories: 3: Food, 4: Transport');
    await expect(
      describeCall("set_plans", "user-1", {
        month: "2026-10",
        plans: [
          { category_name: "Food", amount: 1 },
          { category_name: "FOOD", amount: 2 },
        ],
      }),
    ).rejects.toThrow("Each category may appear only once");
  });

  it("set_plans upserts every plan when applied", async () => {
    q.getCategories.mockResolvedValue(categories);
    m.upsertPlanFor.mockResolvedValue({ ok: true });
    const input = {
      month: "2026-10",
      plans: [
        { category_name: "Food", amount: 250 },
        { category_name: "Transport", amount: 0 },
      ],
    };
    expect(await run("set_plans", "user-1", input)).toEqual({ month: "2026-10", plans: 2 });
    expect(m.upsertPlanFor.mock.calls.map(([u, fd]) => [u, fields(fd)])).toEqual([
      ["user-1", { category_id: "3", month: "2026-10", amount: "250" }],
      ["user-1", { category_id: "4", month: "2026-10", amount: "0" }],
    ]);
  });

  const milk = { name: "Milk", brand: null, cost: 2.1, product_type: null, tags: [], description: null, price: null, amount: null, unit: null, discount: null };
  const bread = { ...milk, name: "Bread", cost: 1.5 };

  it("create_transaction with products validates and lists them", async () => {
    m.parseProductFields.mockImplementation((fd: FormData) =>
      fd.get("name") === "Milk" ? milk : fd.get("name") === "Eggs" ? { error: "Cost must be positive" } : bread,
    );
    const input = {
      type: "spend",
      amount: 3.6,
      date: "2026-09-17",
      products: [
        { name: "Milk", cost: 2.1 },
        { name: "Bread", cost: 1.5 },
      ],
    };
    expect(await describeCall("create_transaction", "user-1", input)).toContain(
      "products: Milk 2.1, Bread 1.5 (costs sum to 3.6)",
    );
    await expect(
      describeCall("create_transaction", "user-1", { ...input, products: [{ name: "Milk" }, { name: "Eggs" }] }),
    ).rejects.toThrow("Product 2: Cost must be positive");
    await expect(describeCall("create_transaction", "user-1", { ...input, receipt_id: 4 })).rejects.toThrow(
      "Pass products or receipt_id, not both",
    );
  });

  it("create_transaction with products inserts them and recomputes the status", async () => {
    m.parseProductFields.mockImplementation((fd: FormData) => (fd.get("name") === "Milk" ? milk : bread));
    m.createTransactionFor.mockResolvedValue({ ok: true, id: 11 });
    const input = {
      type: "spend",
      amount: 3.6,
      date: "2026-09-17",
      products: [
        { name: "Milk", cost: 2.1, tags: ["dairy", "fresh"] },
        { name: "Bread", cost: 1.5 },
      ],
    };

    expect(await run("create_transaction", "user-1", input)).toEqual({ transaction_id: 11 });

    expect(fields(m.createTransactionFor.mock.calls[0][1])).not.toHaveProperty("products");
    expect(fields(m.parseProductFields.mock.calls[0][0])).toEqual({ name: "Milk", cost: "2.1", tags: "dairy,fresh" });
    expect(m.insertProducts).toHaveBeenCalledWith("user-1", 11, [milk, bread]);
    expect(m.recomputeTransactionStatus).toHaveBeenCalledWith("user-1", 11);
    expect(upsertReceipt).not.toHaveBeenCalled();
  });
});

describe("convert_currency", () => {
  it("converts at the NBU rate, defaulting to today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    cur.convert.mockResolvedValue({ result: 1215, rate_date: "2026-10-14", uah_per_unit: { EUR: 48.6 } });

    expect(await run("convert_currency", "user-1", { amount: 25, from: "EUR", to: "UAH" })).toEqual({
      amount: 25,
      from: "EUR",
      to: "UAH",
      result: 1215,
      rate_date: "2026-10-14",
      uah_per_unit: { EUR: 48.6 },
      source: "NBU official rate",
    });
    expect(cur.convert).toHaveBeenCalledWith(25, "EUR", "UAH", "2026-10-14");
    vi.useRealTimers();
  });

  it("reports a missing rate as a tool error", async () => {
    cur.convert.mockRejectedValue(new cur.CurrencyError("Couldn't get the USD exchange rate"));
    await expect(run("convert_currency", "user-1", { amount: 1, from: "USD", to: "UAH", date: "2026-01-01" })).rejects.toThrow(
      AgentToolError,
    );
  });
});

describe("receipt tools", () => {
  const scan = {
    store: "Shop",
    total: 12.5,
    date: "2026-09-17",
    category: "Food",
    products: [
      { name: "Milk", brand: null, cost: 2.5, product_type: null, tags: [], description: null, price: null, amount: 1, unit: "l", discount: null },
      { name: "Bread", brand: null, cost: 10, product_type: null, tags: [], description: null, price: null, amount: null, unit: null, discount: null },
    ],
  };
  // What convertScanToBase hands back (a UAH scan comes back unchanged).
  const converted = { scan, currency: "UAH", original_total: null, rate: null };
  beforeEach(() => {
    cur.convertScanToBase.mockResolvedValue(converted);
  });
  const attachment = (s: typeof scan | null = null) => ({
    id: 4,
    image: Buffer.from("AAAA", "base64"),
    content_type: "image/jpeg",
    scan: s,
  });

  it("scan_receipt reads the user's own attachment, stores and returns the scan", async () => {
    query.mockResolvedValueOnce({ rows: [attachment()] }).mockResolvedValueOnce({ rowCount: 1 });
    q.getCategories.mockResolvedValue([{ id: 3, name: "Food", priority: 5 }]);
    scanReceipt.mockResolvedValue(scan);

    const out = (await run("scan_receipt", "user-1", { receipt_id: 4 })) as Record<string, unknown>;

    expect(query.mock.calls[0][1]).toEqual([4, "user-1"]);
    expect(scanReceipt).toHaveBeenCalledWith("data:image/jpeg;base64,AAAA", ["Food"]);
    expect(query.mock.calls[1][0]).toMatch(/UPDATE agent_attachments SET scan/);
    expect(JSON.parse(query.mock.calls[1][1][0])).toEqual(scan);
    expect(query.mock.calls[1][1].slice(1)).toEqual([4, "user-1"]);
    expect(out).toMatchObject({ receipt_id: 4, total: 12.5, product_cost_sum: 12.5, suggested_category: "Food" });
    expect(out.products).toEqual([
      { name: "Milk", cost: 2.5, amount: 1, unit: "l" },
      { name: "Bread", cost: 10, amount: null, unit: null },
    ]);
  });

  it("scan_receipt refuses a missing or foreign attachment, and reports a failed scan", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(run("scan_receipt", "user-1", { receipt_id: 4 })).rejects.toThrow("Receipt 4 not found");
    expect(scanReceipt).not.toHaveBeenCalled();

    query.mockResolvedValueOnce({ rows: [attachment()] });
    q.getCategories.mockResolvedValue([]);
    scanReceipt.mockRejectedValue(new Error("OpenAI down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(run("scan_receipt", "user-1", { receipt_id: 4 })).rejects.toThrow(AgentToolError);
  });

  it("create_transaction with receipt_id needs a scan and summarizes it", async () => {
    const input = { type: "spend", date: "2026-09-17", receipt_id: 4 };
    query.mockResolvedValueOnce({ rows: [attachment()] });
    await expect(describeCall("create_transaction", "user-1", input)).rejects.toThrow(/call scan_receipt first/);

    // A scanned receipt alone is enough — no amount or category needed.
    query.mockResolvedValueOnce({ rows: [attachment(scan)] });
    expect(await describeCall("create_transaction", "user-1", input)).toContain(
      "receipt: 2 products, total 12.5",
    );
  });

  it("create_transaction with receipt_id attaches the photo, total and scanned products", async () => {
    query.mockResolvedValue({ rows: [attachment(scan)] });
    q.getCategories.mockResolvedValue([{ id: 3, name: "Food", priority: 5 }]);
    m.createTransactionFor.mockResolvedValue({ ok: true, id: 11 });

    const input = { type: "spend", amount: 12.5, date: "2026-09-17", category_name: "Food", receipt_id: 4 };
    expect(await run("create_transaction", "user-1", input)).toEqual({ transaction_id: 11 });

    const fd = fields(m.createTransactionFor.mock.calls[0][1]);
    expect(fd.has_receipt).toBe("1");
    expect(fd).not.toHaveProperty("receipt_id");
    expect(upsertReceipt).toHaveBeenCalledWith("user-1", 11, {
      bytes: Buffer.from("AAAA", "base64"),
      contentType: "image/jpeg",
    });
    expect(cur.convertScanToBase).toHaveBeenCalledWith(scan, "2026-09-17");
    expect(setReceiptTotal).toHaveBeenCalledWith("user-1", 11, converted);
    expect(m.insertProducts).toHaveBeenCalledWith("user-1", 11, converted.scan.products);
    expect(m.recomputeTransactionStatus).toHaveBeenCalledWith("user-1", 11);
  });

  it("create_transaction with a USD receipt shows the total as printed and stores it converted", async () => {
    const usd = { ...scan, currency: "USD" };
    query.mockResolvedValue({ rows: [attachment(usd)] });
    q.getCategories.mockResolvedValue([{ id: 3, name: "Food", priority: 5 }]);
    const input = { type: "spend", date: "2026-09-17", category_name: "Food", receipt_id: 4 };
    expect(await describeCall("create_transaction", "user-1", input)).toContain(
      "total 12.5 USD (converted to UAH on Accept)",
    );
  });

  const storedReceipt = (s: typeof scan | null = null) => ({
    id: 7,
    image: Buffer.from("BBBB", "base64"),
    content_type: "image/png",
    scan: s,
  });

  it("scan_receipt re-reads a transaction's stored photo and caches the scan", async () => {
    q.getTransaction.mockResolvedValue(tx);
    getStoredReceipt.mockResolvedValue(storedReceipt());
    q.getCategories.mockResolvedValue([{ id: 3, name: "Food", priority: 5 }]);
    scanReceipt.mockResolvedValue(scan);

    const out = (await run("scan_receipt", "user-1", { transaction_id: 9 })) as Record<string, unknown>;

    expect(scanReceipt).toHaveBeenCalledWith("data:image/png;base64,BBBB", ["Food"]);
    expect(saveReceiptScan).toHaveBeenCalledWith("user-1", 9, scan);
    expect(query).not.toHaveBeenCalled(); // never touches agent_attachments
    expect(out).toMatchObject({ transaction_id: 9, total: 12.5, product_cost_sum: 12.5 });
  });

  it("scan_receipt needs exactly one id, and a transaction that has a photo", async () => {
    expect(() => parseToolInput(tool("scan_receipt"), {})).toThrow(/exactly one/);
    expect(() => parseToolInput(tool("scan_receipt"), { receipt_id: 4, transaction_id: 9 })).toThrow(
      /exactly one/,
    );

    q.getTransaction.mockResolvedValue(tx);
    getStoredReceipt.mockResolvedValue(null);
    await expect(run("scan_receipt", "user-1", { transaction_id: 9 })).rejects.toThrow(
      "Transaction 9 has no stored receipt photo",
    );
    expect(scanReceipt).not.toHaveBeenCalled();
  });

  it("apply_receipt_scan needs a cached scan and summarizes what it replaces", async () => {
    q.getTransaction.mockResolvedValue(tx);
    getStoredReceipt.mockResolvedValue(storedReceipt());
    await expect(describeCall("apply_receipt_scan", "user-1", { transaction_id: 9 })).rejects.toThrow(
      /call scan_receipt first/,
    );

    getStoredReceipt.mockResolvedValue(storedReceipt(scan));
    const summary = await describeCall("apply_receipt_scan", "user-1", { transaction_id: 9 });
    expect(summary).toContain("products: 0 → 2");
    expect(summary).toContain("scanned total: — → 12.5");
  });

  it("apply_receipt_scan replaces the line items with the cached scan on accept", async () => {
    q.getTransaction.mockResolvedValue(tx);
    getStoredReceipt.mockResolvedValue(storedReceipt(scan));
    q.getCategories.mockResolvedValue([{ id: 3, name: "Food", priority: 5 }]);

    expect(await run("apply_receipt_scan", "user-1", { transaction_id: 9 })).toEqual({
      transaction_id: 9,
      products: 2,
      total: 12.5,
    });

    expect(deleteTransactionProducts).toHaveBeenCalledWith("user-1", 9);
    expect(applyScanToTransaction).toHaveBeenCalledWith("user-1", 9, scan, [
      { id: 3, name: "Food", priority: 5 },
    ]);
    expect(m.recomputeTransactionStatus).toHaveBeenCalledWith("user-1", 9);
    expect(scanReceipt).not.toHaveBeenCalled(); // applies the cached scan, never rescans
  });

  it("apply_receipt_scan still recomputes status when applying fails", async () => {
    q.getTransaction.mockResolvedValue(tx);
    getStoredReceipt.mockResolvedValue(storedReceipt(scan));
    q.getCategories.mockResolvedValue([]);
    applyScanToTransaction.mockRejectedValue(new Error("db down"));

    await expect(run("apply_receipt_scan", "user-1", { transaction_id: 9 })).rejects.toThrow("db down");
    expect(m.recomputeTransactionStatus).toHaveBeenCalledWith("user-1", 9);
  });

  it("replace_receipt_photo files a scanned chat photo onto an existing transaction", async () => {
    q.getTransaction.mockResolvedValue(tx);
    q.getCategories.mockResolvedValue([]);
    query.mockResolvedValue({ rows: [attachment(scan)] });

    const input = { transaction_id: 9, receipt_id: 4 };
    expect(await describeCall("replace_receipt_photo", "user-1", input)).toContain(
      "Replace the receipt photo of transaction #9",
    );
    expect(await run("replace_receipt_photo", "user-1", input)).toEqual({
      transaction_id: 9,
      products: 2,
      total: 12.5,
    });

    expect(upsertReceipt).toHaveBeenCalledWith(
      "user-1",
      9,
      { bytes: Buffer.from("AAAA", "base64"), contentType: "image/jpeg" },
      12.5,
      scan,
    );
    expect(deleteTransactionProducts).toHaveBeenCalledWith("user-1", 9);
    expect(applyScanToTransaction).toHaveBeenCalledWith("user-1", 9, scan, []);
  });

  it("replace_receipt_photo refuses an unscanned attachment", async () => {
    q.getTransaction.mockResolvedValue(tx);
    query.mockResolvedValue({ rows: [attachment()] });
    await expect(
      describeCall("replace_receipt_photo", "user-1", { transaction_id: 9, receipt_id: 4 }),
    ).rejects.toThrow(/call scan_receipt first/);
  });

  it("create_transaction still recomputes status when attaching the receipt fails", async () => {
    query.mockResolvedValue({ rows: [attachment(scan)] });
    m.createTransactionFor.mockResolvedValue({ ok: true, id: 11 });
    upsertReceipt.mockRejectedValue(new Error("disk full"));
    await expect(
      run("create_transaction", "user-1", { type: "spend", date: "2026-09-17", receipt_id: 4 }),
    ).rejects.toThrow("disk full");
    expect(m.recomputeTransactionStatus).toHaveBeenCalledWith("user-1", 11);
  });
});
