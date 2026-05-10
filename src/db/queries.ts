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

export async function getCategories(): Promise<Category[]> {
  const { rows } = await pool.query<Category>(
    "SELECT * FROM categories ORDER BY priority DESC, name ASC"
  );
  return rows;
}

export async function getAvailableMonths(): Promise<string[]> {
  const { rows } = await pool.query<{ month: string }>(
    `SELECT month FROM (
       SELECT DISTINCT LEFT(date, 7) AS month FROM transactions
       UNION
       SELECT DISTINCT month FROM plans
     ) m
     WHERE month ~ '^\\d{4}-\\d{2}$'
     ORDER BY month DESC`
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
  month: string,
  categoryIds?: number[] | null,
): Promise<PlanEntry[]> {
  const params: unknown[] = [month];
  let categoryClause = "";
  if (categoryIds && categoryIds.length >= 0) {
    params.push(categoryIds);
    categoryClause = ` WHERE c.id = ANY($${params.length}::int[])`;
  }
  const { rows } = await pool.query<PlanEntry>(
    `SELECT c.id AS category_id, c.name AS category_name,
            p.id AS plan_id, p.amount,
            COALESCE(SUM(CASE WHEN t.type = 'spend' THEN t.amount END), 0) AS spent
     FROM categories c
     LEFT JOIN plans p ON p.category_id = c.id AND p.month = $1
     LEFT JOIN transactions t ON t.category_id = c.id AND LEFT(t.date, 7) = $1
     ${categoryClause}
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
  months: string[],
  categoryIds?: number[] | null,
): Promise<PlanSummaryEntry[]> {
  if (months.length === 0) return [];
  const params: unknown[] = [months];
  let categoryClause = "";
  if (categoryIds && categoryIds.length >= 0) {
    params.push(categoryIds);
    categoryClause = ` WHERE c.id = ANY($${params.length}::int[])`;
  }
  const { rows } = await pool.query<PlanSummaryEntry>(
    `SELECT c.id AS category_id, c.name AS category_name,
            COALESCE(plan_sum.amount, 0) AS amount,
            COALESCE(spent_sum.spent, 0) AS spent
     FROM categories c
     LEFT JOIN (
       SELECT category_id, SUM(amount) AS amount
       FROM plans
       WHERE month = ANY($1::text[])
       GROUP BY category_id
     ) plan_sum ON plan_sum.category_id = c.id
     LEFT JOIN (
       SELECT category_id, SUM(amount) AS spent
       FROM transactions
       WHERE type = 'spend' AND LEFT(date, 7) = ANY($1::text[])
       GROUP BY category_id
     ) spent_sum ON spent_sum.category_id = c.id
     ${categoryClause}
     ORDER BY c.priority DESC, c.name ASC`,
    params,
  );
  return rows;
}

export async function getExpendituresByCategory(
  f: QueryFilters = {},
): Promise<ExpenditureByCategory[]> {
  const where: string[] = ["t.type = 'spend'"];
  const params: unknown[] = [];

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
  months: string[],
  categoryIds: number[] | null,
  bucket: Bucket,
): Promise<ExpenditureSeriesRow[]> {
  if (months.length === 0) return [];

  const bucketExpr = bucket === "day" ? "t.date" : "LEFT(t.date, 7)";

  const params: unknown[] = [months];
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
     WHERE t.type = 'spend'
       AND LEFT(t.date, 7) = ANY($1::text[])
       ${categoryClause}
     GROUP BY c.id, c.name, c.priority, bucket
     ORDER BY c.priority DESC, c.name ASC, bucket ASC`,
    params,
  );
  return rows;
}

export async function getTransactions(
  f: QueryFilters = {},
): Promise<Transaction[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (f.months && f.months.length >= 0) {
    params.push(f.months);
    where.push(`LEFT(t.date, 7) = ANY($${params.length}::text[])`);
  }
  if (f.categoryIds && f.categoryIds.length >= 0) {
    params.push(f.categoryIds);
    where.push(`t.category_id = ANY($${params.length}::int[])`);
  }

  const whereClause = where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`;

  const { rows } = await pool.query<Transaction>(
    `SELECT t.*, c.name AS category_name
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     ${whereClause}
     ORDER BY t.date DESC, t.id DESC`,
    params,
  );
  return rows;
}
