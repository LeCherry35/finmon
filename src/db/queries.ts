import { pool } from "@/db";
import type { Category } from "@/actions/categories";
import type { Transaction } from "@/actions/transactions";
import type { Product } from "@/actions/products";
import type { Bucket } from "@/lib/charts";

export type ExpenditureByCategory = {
  category_id: number;
  category_name: string;
  total: number;
  count: number;
};

export type ExpenditureSeriesRow = {
  category_id: number;
  category_name: string;
  priority: number;
  bucket: string;
  total: number;
};

export type QueryFilters = {
  months?: string[];
  categoryIds?: number[] | null;
};

/**
 * Builds a `<column> = ANY($n::<type>[])` predicate, pushing `arr` onto `params`
 * and binding it to the next 1-based placeholder. Returns "" when `arr` is
 * null/undefined (no filter). An empty array still produces a predicate —
 * `= ANY('{}')` matches no rows, the intended "everything deselected → show
 * nothing" behavior of the filter UI.
 */
function anyArrayFilter(
  column: string,
  arr: readonly (string | number)[] | null | undefined,
  type: "int" | "text",
  params: unknown[],
): string {
  if (!arr) return "";
  params.push(arr);
  return `${column} = ANY($${params.length}::${type}[])`;
}

export async function getCategories(userId: string): Promise<Category[]> {
  const { rows } = await pool.query<Category>(
    "SELECT * FROM categories WHERE user_id = $1 ORDER BY priority DESC, name ASC",
    [userId],
  );
  return rows;
}

/** Whether `categoryId` exists and belongs to `userId`. Used by writes to
 *  reject cross-tenant or stale category references before mutating. */
export async function userOwnsCategory(
  userId: string,
  categoryId: number,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    "SELECT 1 FROM categories WHERE id = $1 AND user_id = $2",
    [categoryId, userId],
  );
  return (rowCount ?? 0) > 0;
}

/** Whether `transactionId` exists and belongs to `userId`. Used by product
 *  writes to reject cross-tenant or stale transaction references. */
export async function userOwnsTransaction(
  userId: string,
  transactionId: number,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    "SELECT 1 FROM transactions WHERE id = $1 AND user_id = $2",
    [transactionId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export type ReceiptImage = {
  image: Buffer;
  content_type: string;
};

/** The stored receipt photo by receipt id, scoped to `userId` — the route
 *  handler at /api/receipts/[id] streams it. Null when it doesn't exist or
 *  belongs to another user. */
export async function getReceiptImage(
  userId: string,
  receiptId: number,
): Promise<ReceiptImage | null> {
  const { rows } = await pool.query<ReceiptImage>(
    "SELECT image, content_type FROM receipts WHERE user_id = $1 AND id = $2",
    [userId, receiptId],
  );
  return rows[0] ?? null;
}

export async function getAvailableMonths(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ month: string }>(
    `SELECT month FROM (
       SELECT DISTINCT LEFT(date, 7) AS month FROM transactions WHERE user_id = $1
       UNION
       SELECT DISTINCT month FROM plans WHERE user_id = $1
     ) m
     WHERE month ~ '^\\d{4}-\\d{2}$'
     ORDER BY month DESC`,
    [userId],
  );
  return rows.map((r) => r.month);
}

export type PlanEntry = {
  category_id: number;
  category_name: string;
  plan_id: number | null;
  amount: number | null;
  spent: number;
};

export async function getPlansForMonth(
  userId: string,
  month: string,
  categoryIds?: number[] | null,
): Promise<PlanEntry[]> {
  const params: unknown[] = [userId, month];
  const cat = anyArrayFilter("c.id", categoryIds, "int", params);
  const categoryClause = cat ? ` AND ${cat}` : "";
  const { rows } = await pool.query<PlanEntry>(
    `SELECT c.id AS category_id, c.name AS category_name,
            p.id AS plan_id, p.amount,
            COALESCE(SUM(CASE WHEN t.type = 'spend' THEN COALESCE(t.amount, r.total) END), 0) AS spent
     FROM categories c
     LEFT JOIN plans p
       ON p.category_id = c.id AND p.month = $2 AND p.user_id = $1
     LEFT JOIN transactions t
       ON t.category_id = c.id AND LEFT(t.date, 7) = $2 AND t.user_id = $1
     LEFT JOIN receipts r ON r.transaction_id = t.id
     WHERE c.user_id = $1${categoryClause}
     GROUP BY c.id, c.name, c.priority, p.id, p.amount
     ORDER BY c.priority DESC, c.name ASC`,
    params,
  );
  return rows;
}

export type PlanSummaryEntry = {
  category_id: number;
  category_name: string;
  amount: number;
  spent: number;
};

export async function getPlansSummary(
  userId: string,
  months: string[],
  categoryIds?: number[] | null,
): Promise<PlanSummaryEntry[]> {
  if (months.length === 0) return [];
  const params: unknown[] = [userId, months];
  const cat = anyArrayFilter("c.id", categoryIds, "int", params);
  const categoryClause = cat ? ` AND ${cat}` : "";
  const { rows } = await pool.query<PlanSummaryEntry>(
    `SELECT c.id AS category_id, c.name AS category_name,
            COALESCE(plan_sum.amount, 0) AS amount,
            COALESCE(spent_sum.spent, 0) AS spent
     FROM categories c
     LEFT JOIN (
       SELECT category_id, SUM(amount) AS amount
       FROM plans
       WHERE user_id = $1 AND month = ANY($2::text[])
       GROUP BY category_id
     ) plan_sum ON plan_sum.category_id = c.id
     LEFT JOIN (
       SELECT t.category_id, SUM(COALESCE(t.amount, r.total)) AS spent
       FROM transactions t
       LEFT JOIN receipts r ON r.transaction_id = t.id
       WHERE t.user_id = $1 AND t.type = 'spend' AND LEFT(t.date, 7) = ANY($2::text[])
       GROUP BY t.category_id
     ) spent_sum ON spent_sum.category_id = c.id
     WHERE c.user_id = $1${categoryClause}
     ORDER BY c.priority DESC, c.name ASC`,
    params,
  );
  return rows;
}

export async function getExpendituresByCategory(
  userId: string,
  f: QueryFilters = {},
): Promise<ExpenditureByCategory[]> {
  const where: string[] = ["t.user_id = $1", "t.type = 'spend'"];
  const params: unknown[] = [userId];

  const monthFilter = anyArrayFilter("LEFT(t.date, 7)", f.months, "text", params);
  if (monthFilter) where.push(monthFilter);
  const catFilter = anyArrayFilter("t.category_id", f.categoryIds, "int", params);
  if (catFilter) where.push(catFilter);

  // COALESCE: a scan-only transaction (no manual amount yet) still counts at
  // its scanned receipt total. receipts.transaction_id is UNIQUE — no row
  // multiplication.
  const { rows } = await pool.query<ExpenditureByCategory>(
    `SELECT c.id AS category_id, c.name AS category_name, SUM(COALESCE(t.amount, r.total)) AS total, COUNT(*)::INT AS count
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     LEFT JOIN receipts r ON r.transaction_id = t.id
     WHERE ${where.join(" AND ")}
     GROUP BY t.category_id, c.id, c.name
     ORDER BY total DESC`,
    params,
  );
  return rows;
}

export async function getExpenditureSeries(
  userId: string,
  months: string[],
  categoryIds: number[] | null,
  bucket: Bucket,
): Promise<ExpenditureSeriesRow[]> {
  if (months.length === 0) return [];

  const bucketExpr = bucket === "day" ? "t.date" : "LEFT(t.date, 7)";

  const params: unknown[] = [userId, months];
  const cat = anyArrayFilter("t.category_id", categoryIds, "int", params);
  const categoryClause = cat ? ` AND ${cat}` : "";

  const { rows } = await pool.query<ExpenditureSeriesRow>(
    `SELECT c.id AS category_id,
            c.name AS category_name,
            c.priority,
            ${bucketExpr} AS bucket,
            SUM(COALESCE(t.amount, r.total))::float8 AS total
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     LEFT JOIN receipts r ON r.transaction_id = t.id
     WHERE t.user_id = $1
       AND t.type = 'spend'
       AND LEFT(t.date, 7) = ANY($2::text[])
       ${categoryClause}
     GROUP BY c.id, c.name, c.priority, bucket
     ORDER BY c.priority DESC, c.name ASC, bucket ASC`,
    params,
  );
  return rows;
}

export async function getTransactions(
  userId: string,
  f: QueryFilters = {},
): Promise<Transaction[]> {
  const where: string[] = ["t.user_id = $1"];
  const params: unknown[] = [userId];

  const monthFilter = anyArrayFilter("LEFT(t.date, 7)", f.months, "text", params);
  if (monthFilter) where.push(monthFilter);
  const catFilter = anyArrayFilter("t.category_id", f.categoryIds, "int", params);
  if (catFilter) where.push(catFilter);

  // receipts.transaction_id is UNIQUE, so the LEFT JOIN never multiplies rows.
  // categories is a LEFT JOIN too: a transaction may have no category until a
  // receipt scan (or the user) fills one in.
  const { rows } = await pool.query<Transaction>(
    `SELECT t.*, c.name AS category_name, r.id AS receipt_id, r.total AS scanned_total, r.discount AS scanned_discount
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN receipts r ON r.transaction_id = t.id
     WHERE ${where.join(" AND ")}
     ORDER BY t.date DESC, t.id DESC`,
    params,
  );

  // Attach each transaction's product line items in one extra round-trip,
  // grouped in JS by transaction_id (rows already come back oldest-first per tx).
  if (rows.length === 0) return rows;
  const { rows: products } = await pool.query<Product>(
    "SELECT * FROM products WHERE user_id = $1 AND transaction_id = ANY($2::int[]) ORDER BY transaction_id, id ASC",
    [userId, rows.map((t) => t.id)],
  );
  const byTx = new Map<number, Product[]>();
  for (const p of products) {
    const list = byTx.get(p.transaction_id);
    if (list) list.push(p);
    else byTx.set(p.transaction_id, [p]);
  }
  for (const t of rows) t.products = byTx.get(t.id) ?? [];
  return rows;
}
