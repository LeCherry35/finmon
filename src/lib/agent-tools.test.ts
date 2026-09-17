import { beforeEach, describe, expect, it, vi } from "vitest";

const q = vi.hoisted(() => ({
  getAvailableMonths: vi.fn(),
  getCategories: vi.fn(),
  getCategory: vi.fn(),
  getExpendituresByCategory: vi.fn(),
  getPlansForMonth: vi.fn(),
  getProduct: vi.fn(),
  getTransaction: vi.fn(),
  getTransactions: vi.fn(),
}));
const m = vi.hoisted(() => ({
  createTransactionFor: vi.fn(),
  updateTransactionFor: vi.fn(),
  deleteTransactionFor: vi.fn(),
  verifyTransactionFor: vi.fn(),
  addProductFor: vi.fn(),
  updateProductFor: vi.fn(),
  deleteProductFor: vi.fn(),
  createCategoryFor: vi.fn(),
  updateCategoryFor: vi.fn(),
  upsertPlanFor: vi.fn(),
}));

vi.mock("@/db/queries", () => q);
vi.mock("@/lib/mutations/transactions", () => m);
vi.mock("@/lib/mutations/products", () => m);
vi.mock("@/lib/mutations/categories", () => m);
vi.mock("@/lib/mutations/plans", () => m);

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
  date: "2026-09-01",
  note: null,
  store: "Shop",
  category_id: 3,
  category_name: "Food",
  status: "unverified",
  products: [],
};

beforeEach(() => {
  for (const fn of [...Object.values(q), ...Object.values(m)]) fn.mockReset();
});

describe("registry", () => {
  it("requires approval for every tool that can change data, and only those", () => {
    const approval = AGENT_TOOLS.filter((t) => t.requiresApproval).map((t) => t.name).sort();
    expect(approval).toEqual(
      [
        "add_product",
        "create_category",
        "create_transaction",
        "delete_product",
        "delete_transaction",
        "set_plan",
        "update_category",
        "update_product",
        "update_transaction",
        "verify_transaction",
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
      { months: ["2026-09"], categoryIds: null },
      "date",
      "shop",
    );
    expect(found.total_matches).toBe(2);
    expect(found.transactions).toHaveLength(1);

    q.getPlansForMonth.mockResolvedValue([]);
    await run("get_plans", "user-1", { month: "2026-09" });
    expect(q.getPlansForMonth).toHaveBeenCalledWith("user-1", "2026-09");
  });

  it("get_transaction reports a missing/foreign id as a tool error", async () => {
    q.getTransaction.mockResolvedValue(null);
    await expect(run("get_transaction", "user-1", { id: 9 })).rejects.toThrow("Transaction 9 not found");
    expect(q.getTransaction).toHaveBeenCalledWith("user-1", 9);
  });
});

describe("write tools", () => {
  it("update_transaction describes only the fields that change", async () => {
    q.getTransaction.mockResolvedValue(tx);
    const summary = await describeCall("update_transaction", "user-1", { id: 9, amount: 12.5, store: "Shop" });
    expect(summary).toBe("Update transaction #9 spend 10 on 2026-09-01 at Shop (Food)\namount: 10 → 12.5");
  });

  it("update_transaction refuses a no-op or a foreign category", async () => {
    q.getTransaction.mockResolvedValue(tx);
    await expect(describeCall("update_transaction", "user-1", { id: 9, amount: 10 })).rejects.toThrow(
      "Nothing would change",
    );
    q.getCategory.mockResolvedValue(null);
    await expect(describeCall("update_transaction", "user-1", { id: 9, category_id: 77 })).rejects.toThrow(
      "Category 77 not found",
    );
  });

  it("update_transaction merges the patch onto the current row when applied", async () => {
    q.getTransaction.mockResolvedValue(tx);
    m.updateTransactionFor.mockResolvedValue({ ok: true });
    await run("update_transaction", "user-1", { id: 9, amount: 12.5, note: null });
    const [userId, fd] = m.updateTransactionFor.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(fields(fd)).toEqual({
      id: "9",
      type: "spend",
      amount: "12.5",
      date: "2026-09-01",
      note: "",
      store: "Shop",
      category_id: "3",
    });
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

  it("delete_product checks the product belongs to the user before and when applying", async () => {
    q.getProduct.mockResolvedValue(null);
    await expect(describeCall("delete_product", "user-1", { id: 4 })).rejects.toThrow("Product 4 not found");
    await expect(run("delete_product", "user-1", { id: 4 })).rejects.toThrow("Product 4 not found");
    expect(m.deleteProductFor).not.toHaveBeenCalled();
    expect(q.getProduct).toHaveBeenCalledWith("user-1", 4);
  });

  it("set_plan shows the current plan amount in its summary", async () => {
    q.getCategory.mockResolvedValue({ id: 3, name: "Food", priority: 5 });
    q.getPlansForMonth.mockResolvedValue([{ category_id: 3, amount: 200 }]);
    expect(await describeCall("set_plan", "user-1", { category_id: 3, month: "2026-10", amount: 250 })).toBe(
      'Set 2026-10 plan for "Food": 200 → 250',
    );
    expect(q.getPlansForMonth).toHaveBeenCalledWith("user-1", "2026-10", [3]);
  });
});
