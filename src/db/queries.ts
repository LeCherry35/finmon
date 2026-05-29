import { pool } from "@/db";
import type { Category } from "@/actions/categories";
import type { Transaction } from "@/actions/transactions";
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

export async function getCategories(userId: string): Promise<Category[]> {
  const { rows } = await pool.query<Category>(
    "SELECT * FROM categories WHERE user_id = $1 ORDER BY priority DESC, name ASC",
    [userId],
  );
  return rows;
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
  let categoryClause = "";
  if (categoryIds && categoryIds.length >= 0) {
    params.push(categoryIds);
    categoryClause = ` AND c.id = ANY($${params.length}::int[])`;
  }
  const { rows } = await pool.query<PlanEntry>(
    `SELECT c.id AS category_id, c.name AS category_name,
            p.id AS plan_id, p.amount,
            COALESCE(SUM(CASE WHEN t.type = 'spend' THEN t.amount END), 0) AS spent
     FROM categories c
     LEFT JOIN plans p
       ON p.category_id = c.id AND p.month = $2 AND p.user_id = $1
     LEFT JOIN transactions t
       ON t.category_id = c.id AND LEFT(t.date, 7) = $2 AND t.user_id = $1
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
  let categoryClause = "";
  if (categoryIds && categoryIds.length >= 0) {
    params.push(categoryIds);
    categoryClause = ` AND c.id = ANY($${params.length}::int[])`;
  }
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
       SELECT category_id, SUM(amount) AS spent
       FROM transactions
       WHERE user_id = $1 AND type = 'spend' AND LEFT(date, 7) = ANY($2::text[])
       GROUP BY category_id
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

  if (f.months && f.months.length >= 0) {
    params.push(f.months);
    where.push(`LEFT(t.date, 7) = ANY($${params.length}::text[])`);
  }
  if (f.categoryIds && f.categoryIds.length >= 0) {
    params.push(f.categoryIds);
    where.push(`t.category_id = ANY($${params.length}::int[])`);
  }

  const { rows } = await pool.query<ExpenditureByCategory>(
    `SELECT c.id AS category_id, c.name AS category_name, SUM(t.amount) AS total, COUNT(*)::INT AS count
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
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
  let categoryClause = "";
  if (categoryIds && categoryIds.length >= 0) {
    params.push(categoryIds);
    categoryClause = ` AND t.category_id = ANY($${params.length}::int[])`;
  }

  const { rows } = await pool.query<ExpenditureSeriesRow>(
    `SELECT c.id AS category_id,
            c.name AS category_name,
            c.priority,
            ${bucketExpr} AS bucket,
            SUM(t.amount)::float8 AS total
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
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

  if (f.months && f.months.length >= 0) {
    params.push(f.months);
    where.push(`LEFT(t.date, 7) = ANY($${params.length}::text[])`);
  }
  if (f.categoryIds && f.categoryIds.length >= 0) {
    params.push(f.categoryIds);
    where.push(`t.category_id = ANY($${params.length}::int[])`);
  }

  const { rows } = await pool.query<Transaction>(
    `SELECT t.*, c.name AS category_name
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     WHERE ${where.join(" AND ")}
     ORDER BY t.date DESC, t.id DESC`,
    params,
  );
  return rows;
}
