import { pool } from "@/db";
import type { Category } from "@/actions/categories";
import type { Transaction } from "@/actions/transactions";

export type ExpenditureByCategory = {
  category_name: string;
  total: number;
  count: number;
};

export async function getCategories(): Promise<Category[]> {
  const { rows } = await pool.query<Category>(
    "SELECT * FROM categories ORDER BY priority DESC, name ASC"
  );
  return rows;
}

export type PlanEntry = {
  category_id: number;
  category_name: string;
  plan_id: number | null;
  amount: number | null;
  spent: number;
};

export async function getPlansForMonth(month: string): Promise<PlanEntry[]> {
  const { rows } = await pool.query<PlanEntry>(
    `SELECT c.id AS category_id, c.name AS category_name,
            p.id AS plan_id, p.amount,
            COALESCE(SUM(CASE WHEN t.type = 'spend' THEN t.amount END), 0) AS spent
     FROM categories c
     LEFT JOIN plans p ON p.category_id = c.id AND p.month = $1
     LEFT JOIN transactions t ON t.category_id = c.id AND LEFT(t.date, 7) = $2
     GROUP BY c.id, c.name, c.priority, p.id, p.amount
     ORDER BY c.priority DESC, c.name ASC`,
    [month, month]
  );
  return rows;
}

export async function getExpendituresByCategory(): Promise<ExpenditureByCategory[]> {
  const { rows } = await pool.query<ExpenditureByCategory>(
    `SELECT c.name AS category_name, SUM(t.amount) AS total, COUNT(*)::INT AS count
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     WHERE t.type = 'spend'
     GROUP BY t.category_id, c.name
     ORDER BY total DESC`
  );
  return rows;
}

export async function getTransactions(): Promise<Transaction[]> {
  const { rows } = await pool.query<Transaction>(
    `SELECT t.*, c.name AS category_name
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     ORDER BY t.date DESC, t.id DESC`
  );
  return rows;
}
