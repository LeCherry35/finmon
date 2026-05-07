import { readFileSync } from "fs";
import { resolve } from "path";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { pool } = await import("@/db");
    const sql = readFileSync(resolve(process.cwd(), "src/db/schema.sql"), "utf8");
    await pool.query(sql);
  }
}
